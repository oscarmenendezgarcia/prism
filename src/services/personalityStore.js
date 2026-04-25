'use strict';

/**
 * personalityStore — read/write data/agents.json
 *
 * Provides:
 *   listAll()            → AgentPersonality[]
 *   get(agentId)         → AgentPersonality | null
 *   upsert(personality)  → AgentPersonality (saved)
 *   remove(agentId)      → boolean (true if deleted)
 *
 * Implementation details:
 *   - File is created lazily on first write (no file = empty = no personalities set).
 *   - In-memory cache invalidated by mtime comparison on every read.
 *   - Writes are atomic: write to `.tmp` then `renameSync`.
 *   - Per-agentId write mutex prevents interleaved concurrent upserts for the same ID.
 */

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_DIR_DEFAULT = path.join(__dirname, '..', '..', 'data');
let   _dataDir         = DATA_DIR_DEFAULT;

/** Override the data directory (used in tests to point at a temp dir). */
function setDataDir(dir) {
  _dataDir = dir;
  _cache   = null; // invalidate cache when dir changes
}

function getFilePath() {
  return path.join(_dataDir, 'agents.json');
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

/** @type {{ data: Record<string, object>, mtime: number } | null} */
let _cache = null;

/** Read the file into cache if mtime changed (or cache is empty). */
function _loadIfStale() {
  const filePath = getFilePath();
  if (!fs.existsSync(filePath)) {
    _cache = { data: {}, mtime: 0 };
    return;
  }
  try {
    const stat = fs.statSync(filePath);
    if (_cache && _cache.mtime === stat.mtimeMs) return; // still fresh
    const raw = fs.readFileSync(filePath, 'utf8');
    _cache = { data: JSON.parse(raw), mtime: stat.mtimeMs };
  } catch (err) {
    console.error('[personalityStore] ERROR reading agents.json:', err.message);
    if (!_cache) _cache = { data: {}, mtime: 0 };
  }
}

// ---------------------------------------------------------------------------
// Per-agentId write mutex
// ---------------------------------------------------------------------------

/** @type {Map<string, Promise<void>>} */
const _mutexMap = new Map();

/**
 * Serialize writes per agentId. Chains promises so concurrent callers for the
 * same agentId wait their turn without blocking unrelated IDs.
 *
 * @param {string} agentId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
function _withMutex(agentId, fn) {
  const prev = _mutexMap.get(agentId) ?? Promise.resolve();
  let resolvePrev;
  const gate = new Promise((resolve) => { resolvePrev = resolve; });
  _mutexMap.set(agentId, gate);

  return prev.then(() => {
    try {
      return Promise.resolve(fn()).finally(() => {
        resolvePrev();
        // Clean up map entry once the gate resolves to prevent unbounded growth.
        if (_mutexMap.get(agentId) === gate) {
          _mutexMap.delete(agentId);
        }
      });
    } catch (err) {
      resolvePrev();
      return Promise.reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

function _persist(data) {
  const filePath = getFilePath();
  const tmpPath  = filePath + '.tmp';

  // Ensure data dir exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const payload = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmpPath, payload, 'utf8');
  fs.renameSync(tmpPath, filePath);

  // Update cache to reflect the new state
  try {
    const stat = fs.statSync(filePath);
    _cache = { data, mtime: stat.mtimeMs };
  } catch {
    _cache = null; // will reload on next read
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return all personality records as an array.
 * @returns {object[]}
 */
function listAll() {
  _loadIfStale();
  return Object.values(_cache.data);
}

/**
 * Return the personality record for a single agentId, or null if not found.
 * @param {string} agentId
 * @returns {object | null}
 */
function get(agentId) {
  _loadIfStale();
  return _cache.data[agentId] ?? null;
}

/**
 * Create or replace the personality for agentId. Serialized via mutex.
 * @param {object} personality - Must include `agentId`.
 * @returns {Promise<object>} The saved record.
 */
function upsert(personality) {
  const { agentId } = personality;
  if (!agentId || typeof agentId !== 'string') {
    return Promise.reject(new Error('upsert: personality.agentId is required'));
  }
  return _withMutex(agentId, () => {
    _loadIfStale();
    const current   = _cache.data[agentId] ?? {};
    const now       = new Date().toISOString();
    const merged    = { ...current, ...personality, updatedAt: now };
    const nextData  = { ..._cache.data, [agentId]: merged };
    _persist(nextData);
    return merged;
  });
}

/**
 * Delete a personality record. Returns true if deleted, false if not found.
 * @param {string} agentId
 * @returns {Promise<boolean>}
 */
function remove(agentId) {
  return _withMutex(agentId, () => {
    _loadIfStale();
    if (!_cache.data[agentId]) return false;
    const { [agentId]: _dropped, ...rest } = _cache.data;
    _persist(rest);
    return true;
  });
}

/**
 * Expose cache invalidation for tests that swap files externally.
 */
function invalidateCache() {
  _cache = null;
}

module.exports = {
  setDataDir,
  listAll,
  get,
  upsert,
  remove,
  invalidateCache,
};
