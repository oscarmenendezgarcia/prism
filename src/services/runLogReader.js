'use strict';

/**
 * runLogReader.js — Read pipeline run logs and normalize them for agents.
 *
 * Composes:
 *   - runResolver (prefix → full runId + run object)
 *   - fs (per-stage log file reads)
 *   - streamJsonNormalizer (readable text output)
 *
 * The service is invoked by the REST route `GET /api/v1/runs/:runId/logs` and,
 * in turn, by the MCP tool `kanban_get_run_logs`. All FS/resolver/normalizer
 * touchpoints go through injectable seams (`_fs`, `_resolveRun`, `_normalize`)
 * so the service is unit-testable without a real data directory.
 *
 * Contract:
 *   readRunLogs({
 *     runId, stage?, tail?, raw?,
 *     dataDir, maxBytes?,
 *     _fs?, _resolveRun?, _normalize?,
 *   }) → Promise<{
 *     runId, spaceId, taskId, status, currentStage,
 *     stages: [{
 *       index, agentId, cliTool, status,
 *       format, content, bytes, linesOut, truncated,
 *     }]
 *   }>
 *
 * Errors: throws typed errors from runResolver (RunNotFoundError,
 *   AmbiguousRunError, ShortPrefixError) plus BadRequestError for out-of-range
 *   stage index. All other faults surface as plain Error (mapped to 500 by
 *   the route).
 */

const fsDefault   = require('fs');
const path        = require('path');
const runResolver = require('../utils/runResolver');
const { normalize: normalizeDefault } = require('../utils/streamJsonNormalizer');

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

class BadRequestError extends Error {
  constructor(message, details) {
    super(message);
    this.name    = 'BadRequestError';
    this.code    = 'BAD_REQUEST';
    this.details = details || null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.runId
 * @param {number} [opts.stage]      -- 0-based index; omit for all stages
 * @param {number} [opts.tail]       -- last N normalized lines
 * @param {boolean} [opts.raw]       -- return raw bytes (with format detected)
 * @param {string}  opts.dataDir     -- absolute data directory
 * @param {number}  [opts.maxBytes]  -- per-stage byte cap; default from normalizer
 * @param {object}  [opts._fs]
 * @param {Function} [opts._resolveRun]
 * @param {Function} [opts._normalize]
 */
async function readRunLogs(opts) {
  const {
    runId,
    stage,
    tail,
    raw       = false,
    dataDir,
    maxBytes,
    _fs        = fsDefault,
    _resolveRun = runResolver.resolveRun,
    _normalize  = normalizeDefault,
  } = opts || {};

  if (!dataDir || typeof dataDir !== 'string') {
    throw new BadRequestError("'dataDir' is required");
  }

  const { run } = await _resolveRun(runId, { dataDir });
  if (!run || !Array.isArray(run.stages)) {
    // resolver should have thrown; this guards against malformed run.json
    throw new BadRequestError(`Run '${runId}' has no stages`);
  }

  const totalStages = run.stages.length;

  // Which stage indexes to read?
  let indexes;
  if (stage === undefined || stage === null) {
    indexes = Array.from({ length: totalStages }, (_, i) => i);
  } else {
    if (!Number.isInteger(stage) || stage < 0 || stage >= totalStages) {
      throw new BadRequestError(
        `stage ${stage} is out of range (0..${totalStages - 1})`,
        { validRange: [0, totalStages - 1] },
      );
    }
    indexes = [stage];
  }

  const stageEntries = indexes.map((i) => buildStageEntry({
    run, index: i, dataDir, tail, raw, maxBytes, _fs, _normalize,
  }));

  return {
    runId:        run.runId,
    spaceId:      run.spaceId ?? null,
    taskId:       run.taskId  ?? null,
    status:       run.status  ?? null,
    currentStage: typeof run.currentStage === 'number' ? run.currentStage : null,
    stages:       stageEntries,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildStageEntry({ run, index, dataDir, tail, raw, maxBytes, _fs, _normalize }) {
  const rawStageEntry = run.stages[index];
  const agentId       = typeof rawStageEntry === 'string'
    ? rawStageEntry
    : (rawStageEntry && rawStageEntry.agentId) || null;

  const stageStatus   = Array.isArray(run.stageStatuses) ? run.stageStatuses[index] : null;
  const status        = stageStatus && stageStatus.status ? stageStatus.status : 'pending';
  const cliToolMeta   = (stageStatus && stageStatus.cliTool) || null;

  const logPath = path.join(dataDir, 'runs', run.runId, `stage-${index}.log`);

  if (!_fs.existsSync(logPath)) {
    return {
      index,
      agentId,
      cliTool:   cliToolMeta,
      status,
      format:    'plain-text',
      content:   '(no log yet)',
      bytes:     0,
      linesOut:  1,
      truncated: false,
    };
  }

  let text;
  try {
    text = _fs.readFileSync(logPath, 'utf8');
  } catch (err) {
    // Surface as internal error; the route maps to 500.
    const wrapped = new Error(`Failed to read stage log ${index}: ${err.message}`);
    wrapped.code = 'INTERNAL';
    wrapped.cause = err;
    throw wrapped;
  }

  const normalized = _normalize(text, {
    tail,
    raw,
    ...(Number.isInteger(maxBytes) && maxBytes > 0 ? { maxBytes } : {}),
  });

  return {
    index,
    agentId,
    cliTool:   cliToolMeta || null,
    status,
    format:    normalized.format,
    content:   normalized.content,
    bytes:     Buffer.byteLength(text, 'utf8'),
    linesOut:  normalized.linesOut,
    truncated: normalized.truncated,
  };
}

module.exports = {
  readRunLogs,
  BadRequestError,
};
