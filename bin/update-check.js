'use strict';

/**
 * bin/update-check.js — Non-blocking version check module
 *
 * Compares the installed version of prism-kanban against the npm registry
 * and prints a notice to stderr if a newer version is available.
 *
 * Public API:
 *   scheduleUpdateCheck(flags)      — fire-and-forget, never await
 *   fetchLatestVersion(timeoutMs?)  — exported for reuse by update.js
 *   getCachePath()                  — returns absolute path to cache file
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { version: installedVersion } = require(path.join(__dirname, '..', 'package.json'));

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

/**
 * Returns the absolute path to the update cache file.
 * Respects PRISM_UPDATE_CACHE env var override (used in tests).
 */
function getCachePath() {
  if (process.env.PRISM_UPDATE_CACHE) {
    return process.env.PRISM_UPDATE_CACHE;
  }
  const base = process.env.XDG_DATA_HOME
    ? path.join(process.env.XDG_DATA_HOME, 'prism')
    : path.join(os.homedir(), '.local', 'share', 'prism');
  return path.join(base, 'update-cache.json');
}

/**
 * Read and parse the cache file. Returns null on any error.
 * @param {string} cachePath
 * @returns {{ checkedAt: number, latestVersion: string } | null}
 */
function readCache(cachePath) {
  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Returns true if the cache exists and is younger than CACHE_TTL_MS.
 * @param {{ checkedAt: number } | null} cache
 */
function isCacheValid(cache) {
  if (!cache || typeof cache.checkedAt !== 'number' || typeof cache.latestVersion !== 'string') {
    return false;
  }
  return (Date.now() - cache.checkedAt) < CACHE_TTL_MS;
}

/**
 * Write the cache file. Failures are silently ignored.
 * @param {string} cachePath
 * @param {string} latestVersion
 */
function writeCache(cachePath, latestVersion) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const data = JSON.stringify({ checkedAt: Date.now(), latestVersion });
    fs.writeFileSync(cachePath, data, 'utf8');
  } catch {
    // Cache write failure is never fatal
  }
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

const NPM_REGISTRY_URL = 'https://registry.npmjs.org/prism-kanban/latest';

/**
 * Fetch the latest published version from npm registry.
 * Rejects on timeout or network error.
 *
 * @param {number} [timeoutMs=2500]
 * @param {Function} [fetchFn=globalThis.fetch] — injectable for tests
 * @returns {Promise<string>} resolved semver string
 */
async function fetchLatestVersion(timeoutMs = 2500, fetchFn = globalThis.fetch) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), timeoutMs)
  );

  const fetchPromise = fetchFn(NPM_REGISTRY_URL, {
    headers: { Accept: 'application/json' },
  }).then(res => res.json()).then(json => {
    if (typeof json.version !== 'string') {
      throw new Error('unexpected registry response');
    }
    return json.version;
  });

  return Promise.race([fetchPromise, timeoutPromise]);
}

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

/**
 * Semver comparator — compares MAJOR.MINOR.PATCH tuples numerically.
 * Pre-release suffixes (e.g. "-beta", "-rc.1") are stripped before comparison
 * so `Number('1-beta')` → NaN is never reached.
 * Returns true when `latest` is strictly greater than `installed`.
 *
 * @param {string} installed
 * @param {string} latest
 * @returns {boolean}
 */
function isNewer(installed, latest) {
  const parse = v => String(v).replace(/-.*$/, '').split('.').map(Number);
  const [iMaj, iMin, iPat] = parse(installed);
  const [lMaj, lMin, lPat] = parse(latest);

  if (lMaj !== iMaj) return lMaj > iMaj;
  if (lMin !== iMin) return lMin > iMin;
  return lPat > iPat;
}

// ---------------------------------------------------------------------------
// Notice
// ---------------------------------------------------------------------------

/**
 * Print the update notice to stderr.
 * Exported for use in update.js if needed, but primarily used internally.
 *
 * @param {string} installed
 * @param {string} latest
 */
function printUpdateNotice(installed, latest) {
  process.stderr.write(
    `\n✦ Nueva versión disponible: v${installed} → v${latest}. Ejecuta: prism update\n`
  );
}

// ---------------------------------------------------------------------------
// Core check logic (internal, async)
// ---------------------------------------------------------------------------

/**
 * Perform the full check: read cache → fetch if stale → compare → print.
 * All errors are swallowed — this must never crash the CLI.
 *
 * @param {{ fetchFn?: Function }} [opts]
 */
async function runUpdateCheck(opts = {}) {
  const cachePath = getCachePath();
  const fetchFn   = opts.fetchFn || globalThis.fetch;

  try {
    const cache = readCache(cachePath);

    let latestVersion;

    if (isCacheValid(cache)) {
      latestVersion = cache.latestVersion;
    } else {
      // Stale or missing — fetch from npm
      try {
        latestVersion = await fetchLatestVersion(2500, fetchFn);
        writeCache(cachePath, latestVersion);
      } catch {
        // Network timeout or offline — fail silently
        return;
      }
    }

    if (isNewer(installedVersion, latestVersion)) {
      printUpdateNotice(installedVersion, latestVersion);
    }
  } catch {
    // Unexpected error — always fail silently in background check
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget version check. Never await this.
 * The caller proceeds immediately; the check resolves on the next event loop tick.
 *
 * @param {{ noUpdateCheck?: boolean, silent?: boolean, _fetchFn?: Function }} [flags]
 */
function scheduleUpdateCheck(flags = {}) {
  if (flags.noUpdateCheck || flags.silent) return;
  // Intentionally not awaited
  runUpdateCheck({ fetchFn: flags._fetchFn });
}

module.exports = {
  scheduleUpdateCheck,
  fetchLatestVersion,
  getCachePath,
  // Exported for tests
  isCacheValid,
  isNewer,
  printUpdateNotice,
  writeCache,
  readCache,
};
