'use strict';

/**
 * Sidecar cache — read/write/invalidate stage-N.metrics.json
 *
 * Uses mtime-based invalidation: the sidecar is considered stale when
 * stage-N.log has a newer mtime than stage-N.metrics.json.
 *
 * Atomic writes: write to stage-N.metrics.json.tmp then rename (same-dir
 * ensures rename is atomic on POSIX).
 *
 * All methods are defensive — they never throw; failures return null / false
 * and are logged via console.warn.
 */

const fs   = require('fs');
const path = require('path');

/**
 * Build the sidecar path for a given stage.
 *
 * @param {string} runDir
 * @param {number} stageIndex
 * @returns {string}
 */
function sidecarPath(runDir, stageIndex) {
  return path.join(runDir, `stage-${stageIndex}.metrics.json`);
}

/**
 * Try to read a fresh sidecar. Returns parsed StageMetrics or null.
 *
 * "Fresh" means: sidecar exists AND its mtime >= logMtimeMs.
 *
 * @param {string} runDir
 * @param {number} stageIndex
 * @param {number} logMtimeMs - mtime of stage-N.log (Date.getTime()).
 * @returns {object|null} Parsed StageMetrics, or null on miss/stale/error.
 */
function read(runDir, stageIndex, logMtimeMs) {
  const sidecar = sidecarPath(runDir, stageIndex);
  try {
    const sidecarStat = fs.statSync(sidecar);
    // Treat as stale if sidecar is older than the log.
    if (sidecarStat.mtimeMs < logMtimeMs) {
      return null;
    }
    const raw = fs.readFileSync(sidecar, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Atomically write StageMetrics to the sidecar file.
 *
 * @param {string} runDir
 * @param {number} stageIndex
 * @param {object} metrics - StageMetrics object to persist.
 * @returns {boolean} true on success, false on error.
 */
function write(runDir, stageIndex, metrics) {
  const sidecar = sidecarPath(runDir, stageIndex);
  const tmp     = sidecar + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(metrics), 'utf8');
    fs.renameSync(tmp, sidecar);
    return true;
  } catch (err) {
    console.warn(JSON.stringify({
      component: 'logMetrics.cache',
      event:     'sidecar_write_error',
      runDir,
      stageIndex,
      message:   err.message,
    }));
    // Clean up tmp on failure to avoid leaving a partial file.
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    return false;
  }
}

/**
 * Delete the sidecar file (cache invalidation).
 * Called by pipelineManager when a stage is restarted.
 *
 * @param {string} runDir
 * @param {number} stageIndex
 */
function invalidate(runDir, stageIndex) {
  const sidecar = sidecarPath(runDir, stageIndex);
  try {
    fs.unlinkSync(sidecar);
  } catch {
    // Not present — fine.
  }
}

module.exports = { sidecarPath, read, write, invalidate };
