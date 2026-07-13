'use strict';

/**
 * Log Metrics public API
 *
 * parseStageLog(runId, stageIndex, opts) → StageMetrics
 *
 * Parse-on-read flow:
 *   1. Build paths from runId + stageIndex.
 *   2. Unless force=true, check the sidecar cache (mtime-based freshness).
 *   3. On cache miss: detect adapter → stream log → aggregate → write sidecar.
 *   4. Return StageMetrics.
 *
 * Never throws — on hard failure, returns a partial StageMetrics with
 * parser.warnings populated.
 */

const fs   = require('fs');
const path = require('path');

const { detectAdapter }   = require('./detect');
const { aggregate }       = require('./aggregator');
const { read, write }     = require('./cache');
const { projectEvents }   = require('./events');

// Path helpers: use the same logic as pipelineManager to locate run dirs.
// The PIPELINE_RUNS_DIR env var mirrors pipelineManager.runsDir().

/**
 * Resolve the runs directory.
 *
 * @param {string} dataDir
 * @returns {string}
 */
function runsDir(dataDir) {
  return process.env.PIPELINE_RUNS_DIR || path.join(dataDir, 'runs');
}

/**
 * Resolve a run directory path.
 *
 * @param {string} dataDir
 * @param {string} runId
 * @returns {string}
 */
function runDir(dataDir, runId) {
  return path.join(runsDir(dataDir), runId);
}

/**
 * Parse a stage log file and return structured StageMetrics.
 *
 * @param {string}  runId        - UUID of the pipeline run.
 * @param {number}  stageIndex   - Zero-based stage index.
 * @param {string}  agentId      - Agent ID for this stage (e.g. 'developer-agent').
 * @param {string}  dataDir      - Absolute path to the data directory.
 * @param {object}  [opts]
 * @param {boolean} [opts.force] - When true, bypass the sidecar cache.
 * @returns {Promise<import('./types').StageMetrics>}
 */
async function parseStageLog(runId, stageIndex, agentId, dataDir, opts = {}) {
  const { force = false } = opts;

  const dir     = runDir(dataDir, runId);
  const logPath = path.join(dir, `stage-${stageIndex}.log`);

  const parseStart = Date.now();

  // ------------------------------------------------------------------
  // Cache check
  // ------------------------------------------------------------------
  let logMtime = 0;
  try {
    logMtime = fs.statSync(logPath).mtimeMs;
  } catch (err) {
    // Log does not exist — handled by caller (→ 425 or 404).
    throw err;
  }

  if (!force) {
    const cached = read(dir, stageIndex, logMtime);
    if (cached) {
      console.log(JSON.stringify({
        component:  'logMetrics',
        event:      'cache_hit',
        runId,
        stageIndex,
        ms:         Date.now() - parseStart,
      }));
      return cached;
    }
  }

  // ------------------------------------------------------------------
  // Detect adapter
  // ------------------------------------------------------------------
  let adapter, header;
  try {
    ({ adapter, header } = await detectAdapter(dir, stageIndex, logPath));
  } catch (err) {
    console.error(JSON.stringify({
      component:  'logMetrics',
      event:      'detect_error',
      runId,
      stageIndex,
      message:    err.message,
    }));
    adapter = require('./adapters/plainText');
    header  = null;
  }

  const source    = header?.source ?? adapter.name;
  const agentMeta = header?.agentId ?? agentId ?? 'unknown';
  const startedAt = header?.startedAt ?? null;

  // ------------------------------------------------------------------
  // Stream + parse
  // ------------------------------------------------------------------
  let lineStream;
  if (adapter.createLineStream) {
    lineStream = adapter.createLineStream(logPath);
  } else {
    // Generic fallback for adapters that don't provide createLineStream
    const readline  = require('readline');
    const fileStream = require('fs').createReadStream(logPath, { encoding: 'utf8' });
    lineStream = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  }

  const normalizedEvents = adapter.parse(lineStream);

  // ------------------------------------------------------------------
  // Aggregate
  // ------------------------------------------------------------------
  let metrics;
  try {
    metrics = await aggregate(normalizedEvents, {
      runId,
      stageIndex,
      source,
      agentId: agentMeta,
      startedAt,
    });
  } catch (err) {
    console.error(JSON.stringify({
      component:  'logMetrics',
      event:      'aggregate_error',
      runId,
      stageIndex,
      message:    err.message,
    }));
    // Return partial/empty metrics with warning.
    metrics = {
      schemaVersion: 1,
      runId,
      stageIndex,
      source,
      agentId:        agentMeta,
      model:          null,
      duration:       { wallMs: null, apiMs: null, startedAt, endedAt: null },
      turns:          null,
      stopReason:     null,
      terminalReason: null,
      cost:           null,
      tools:          { totalCalls: 0, errors: 0, byName: [] },
      files:          { modified: [], read: [] },
      errors:         { rateLimitEvents: 0, permissionDenials: 0, toolErrors: 0, samples: [] },
      summary:        null,
      parser: {
        parsedAt:      new Date().toISOString(),
        parserVersion: '1.0.0',
        lineCount:     0,
        unknownEvents: 0,
        warnings:      [`Aggregation error: ${err.message}`],
      },
    };
  }

  const parseMs = Date.now() - parseStart;
  if (parseMs > 500) {
    console.warn(JSON.stringify({
      component:  'logMetrics',
      event:      'slow_parse',
      runId,
      stageIndex,
      lines:      metrics.parser.lineCount,
      ms:         parseMs,
    }));
  }
  console.log(JSON.stringify({
    component:  'logMetrics',
    event:      'cache_miss_parsed',
    runId,
    stageIndex,
    adapter:    adapter.name,
    lines:      metrics.parser.lineCount,
    ms:         parseMs,
  }));

  // ------------------------------------------------------------------
  // Write sidecar cache (non-fatal)
  // ------------------------------------------------------------------
  write(dir, stageIndex, metrics);

  return metrics;
}

/**
 * Parse a stage log file and return a paginated list of structured PublicEvents.
 *
 * Unlike parseStageLog (which aggregates into summary metrics), this function
 * streams events in document order, projects them to the PublicEvent DTO, and
 * returns a cursor-based page.
 *
 * No sidecar cache is used — re-parsed on each request.  Log files are
 * typically < 5K lines; a full parse costs < 50 ms in practice.
 *
 * @param {string}  runId        - UUID of the pipeline run.
 * @param {number}  stageIndex   - Zero-based stage index.
 * @param {string}  agentId      - Agent ID for this stage.
 * @param {string}  dataDir      - Absolute path to the data directory.
 * @param {object}  [opts]
 * @param {number}  [opts.since=0] - Return events with idx >= since.
 * @returns {Promise<{ events: object[]; nextSince: number; complete: boolean }>}
 */
async function parseStageEvents(runId, stageIndex, agentId, dataDir, opts = {}) {
  const { since = 0 } = opts;

  const dir     = runDir(dataDir, runId);
  const logPath = path.join(dir, `stage-${stageIndex}.log`);

  // Throws ENOENT when log does not exist — caller maps this to 425.
  // Use statSync to match existing pattern in parseStageLog.
  fs.statSync(logPath);

  let adapter;
  try {
    ({ adapter } = await detectAdapter(dir, stageIndex, logPath));
  } catch (err) {
    console.error(JSON.stringify({
      component:  'logMetrics',
      event:      'events_detect_error',
      runId,
      stageIndex,
      message:    err.message,
    }));
    adapter = require('./adapters/plainText');
  }

  let lineStream;
  if (adapter.createLineStream) {
    lineStream = adapter.createLineStream(logPath);
  } else {
    const readline   = require('readline');
    const fileStream = fs.createReadStream(logPath, { encoding: 'utf8' });
    lineStream = require('readline').createInterface({ input: fileStream, crlfDelay: Infinity });
  }

  const normalizedEvents = adapter.parse(lineStream);
  return projectEvents(normalizedEvents, { since, livePlainSummary: adapter.name === 'plain' });
}

module.exports = { parseStageLog, parseStageEvents, runDir, runsDir };
