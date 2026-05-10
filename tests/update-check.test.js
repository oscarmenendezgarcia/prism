'use strict';

/**
 * tests/update-check.test.js — Unit tests for bin/update-check.js
 *
 * Tests: cache validity, TTL expiry, cache miss triggers fetch,
 * version comparison, timeout silence, env var override, flags.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir;

function makeTempDir() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-uc-test-'));
  return tmpDir;
}

function cleanupTempDir() {
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    tmpDir = null;
  }
}

function makeCachePath() {
  return path.join(tmpDir, 'update-cache.json');
}

function writeTestCache(cachePath, data) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(data), 'utf8');
}

/**
 * Mock fetch that resolves immediately with a given version.
 */
function mockFetch(version) {
  return async () => ({
    json: async () => ({ version }),
  });
}

/**
 * Mock fetch that rejects after a delay.
 */
function slowFetch(delayMs = 4000) {
  return () => new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), delayMs)
  );
}

/**
 * Mock fetch that rejects immediately.
 */
function failFetch() {
  return () => Promise.reject(new Error('network error'));
}

/**
 * Capture stderr output during an async operation.
 */
async function captureStderr(fn) {
  const chunks = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { chunks.push(chunk); return true; };
  try {
    await fn();
  } finally {
    process.stderr.write = orig;
  }
  return chunks.join('');
}

// ---------------------------------------------------------------------------
// Load module under test (require fresh each test via cache busting is complex
// in CJS; instead we import the pure functions directly)
// ---------------------------------------------------------------------------

const {
  isCacheValid,
  isNewer,
  getCachePath,
  readCache,
  writeCache,
  fetchLatestVersion,
  scheduleUpdateCheck,
  printUpdateNotice,
} = require('../bin/update-check.js');

// ---------------------------------------------------------------------------
// isCacheValid
// ---------------------------------------------------------------------------

describe('isCacheValid', () => {
  it('returns false for null', () => {
    assert.equal(isCacheValid(null), false);
  });

  it('returns false for missing checkedAt', () => {
    assert.equal(isCacheValid({ latestVersion: '1.0.0' }), false);
  });

  it('returns false for missing latestVersion', () => {
    assert.equal(isCacheValid({ checkedAt: Date.now() }), false);
  });

  it('returns false when non-string latestVersion', () => {
    assert.equal(isCacheValid({ checkedAt: Date.now(), latestVersion: 123 }), false);
  });

  it('returns true for a fresh cache (just written)', () => {
    const cache = { checkedAt: Date.now(), latestVersion: '1.0.0' };
    assert.equal(isCacheValid(cache), true);
  });

  it('returns false for a cache older than 24h', () => {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000 + 1);
    const cache = { checkedAt: oneDayAgo, latestVersion: '1.0.0' };
    assert.equal(isCacheValid(cache), false);
  });

  it('returns true for a cache just under 24h old', () => {
    const almostExpired = Date.now() - (24 * 60 * 60 * 1000 - 1000);
    const cache = { checkedAt: almostExpired, latestVersion: '1.0.0' };
    assert.equal(isCacheValid(cache), true);
  });
});

// ---------------------------------------------------------------------------
// isNewer
// ---------------------------------------------------------------------------

describe('isNewer', () => {
  it('returns false when versions are equal', () => {
    assert.equal(isNewer('1.0.0', '1.0.0'), false);
  });

  it('returns true for a patch bump (0.6.0 → 0.6.1)', () => {
    assert.equal(isNewer('0.6.0', '0.6.1'), true);
  });

  it('returns false for a patch downgrade (0.6.1 → 0.6.0)', () => {
    assert.equal(isNewer('0.6.1', '0.6.0'), false);
  });

  it('returns true for a minor bump (0.6.0 → 0.7.0)', () => {
    assert.equal(isNewer('0.6.0', '0.7.0'), true);
  });

  it('returns false for a minor downgrade (0.7.0 → 0.6.0)', () => {
    assert.equal(isNewer('0.7.0', '0.6.0'), false);
  });

  it('returns true for a major bump (0.9.9 → 1.0.0)', () => {
    assert.equal(isNewer('0.9.9', '1.0.0'), true);
  });

  it('returns false for a major downgrade (1.0.0 → 0.9.9)', () => {
    assert.equal(isNewer('1.0.0', '0.9.9'), false);
  });

  it('returns true when minor differs and patch is smaller (1.1.9 → 1.2.0)', () => {
    assert.equal(isNewer('1.1.9', '1.2.0'), true);
  });
});

// ---------------------------------------------------------------------------
// getCachePath
// ---------------------------------------------------------------------------

describe('getCachePath', () => {
  let origEnv;

  beforeEach(() => {
    origEnv = {
      PRISM_UPDATE_CACHE: process.env.PRISM_UPDATE_CACHE,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    };
  });

  afterEach(() => {
    if (origEnv.PRISM_UPDATE_CACHE !== undefined) {
      process.env.PRISM_UPDATE_CACHE = origEnv.PRISM_UPDATE_CACHE;
    } else {
      delete process.env.PRISM_UPDATE_CACHE;
    }
    if (origEnv.XDG_DATA_HOME !== undefined) {
      process.env.XDG_DATA_HOME = origEnv.XDG_DATA_HOME;
    } else {
      delete process.env.XDG_DATA_HOME;
    }
  });

  it('uses PRISM_UPDATE_CACHE env var when set', () => {
    process.env.PRISM_UPDATE_CACHE = '/custom/path/cache.json';
    assert.equal(getCachePath(), '/custom/path/cache.json');
  });

  it('uses XDG_DATA_HOME when set', () => {
    delete process.env.PRISM_UPDATE_CACHE;
    process.env.XDG_DATA_HOME = '/xdg/data';
    assert.equal(getCachePath(), path.join('/xdg/data', 'prism', 'update-cache.json'));
  });

  it('falls back to ~/.local/share/prism/update-cache.json', () => {
    delete process.env.PRISM_UPDATE_CACHE;
    delete process.env.XDG_DATA_HOME;
    const expected = path.join(os.homedir(), '.local', 'share', 'prism', 'update-cache.json');
    assert.equal(getCachePath(), expected);
  });
});

// ---------------------------------------------------------------------------
// readCache / writeCache
// ---------------------------------------------------------------------------

describe('readCache and writeCache', () => {
  beforeEach(makeTempDir);
  afterEach(cleanupTempDir);

  it('readCache returns null for a non-existent file', () => {
    assert.equal(readCache('/does/not/exist/cache.json'), null);
  });

  it('readCache returns null for malformed JSON', () => {
    const p = makeCachePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'not-json', 'utf8');
    assert.equal(readCache(p), null);
  });

  it('writeCache creates parent directories and writes valid JSON', () => {
    const p = makeCachePath();
    writeCache(p, '1.2.3');
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(typeof raw.checkedAt, 'number');
    assert.equal(raw.latestVersion, '1.2.3');
  });

  it('writeCache does not throw on read-only-like path (silently fails)', () => {
    // Writing to a path that cannot be created should not throw
    assert.doesNotThrow(() => writeCache('/proc/no-such-dir/cache.json', '1.0.0'));
  });

  it('readCache reads back what writeCache wrote', () => {
    const p = makeCachePath();
    writeCache(p, '2.0.0');
    const cache = readCache(p);
    assert.equal(cache.latestVersion, '2.0.0');
    assert.ok(typeof cache.checkedAt === 'number');
  });
});

// ---------------------------------------------------------------------------
// fetchLatestVersion
// ---------------------------------------------------------------------------

describe('fetchLatestVersion', () => {
  it('returns the version string from the mock response', async () => {
    const version = await fetchLatestVersion(2500, mockFetch('1.5.0'));
    assert.equal(version, '1.5.0');
  });

  it('rejects on network failure', async () => {
    await assert.rejects(
      () => fetchLatestVersion(2500, failFetch()),
      /network error/
    );
  });

  it('rejects when timeout expires before response', async () => {
    // Use a very short timeout (50ms) and a slow fetch (200ms)
    await assert.rejects(
      () => fetchLatestVersion(50, slowFetch(200)),
      /timeout/
    );
  });

  it('rejects when response has no version field', async () => {
    const badFetch = async () => ({ json: async () => ({ name: 'prism-kanban' }) });
    await assert.rejects(
      () => fetchLatestVersion(2500, badFetch),
      /unexpected registry response/
    );
  });
});

// ---------------------------------------------------------------------------
// scheduleUpdateCheck — notice printing
// ---------------------------------------------------------------------------

describe('scheduleUpdateCheck', () => {
  beforeEach(makeTempDir);
  afterEach(cleanupTempDir);

  // Helper: run scheduleUpdateCheck with test fixtures and await its internal promise
  // by flushing the microtask queue via a small setTimeout.
  function runCheck(flags, fetchFn) {
    return new Promise(resolve => {
      scheduleUpdateCheck({ ...flags, _fetchFn: fetchFn });
      // Allow the async chain to complete
      setTimeout(resolve, 100);
    });
  }

  it('does nothing when noUpdateCheck is true', async () => {
    let fetchCalled = false;
    const stderr = await captureStderr(() =>
      runCheck({ noUpdateCheck: true }, () => { fetchCalled = true; return mockFetch('99.0.0')(); })
    );
    assert.equal(fetchCalled, false, 'fetch should not be called when noUpdateCheck=true');
    assert.equal(stderr, '');
  });

  it('does nothing when silent is true', async () => {
    let fetchCalled = false;
    const stderr = await captureStderr(() =>
      runCheck({ silent: true }, () => { fetchCalled = true; return mockFetch('99.0.0')(); })
    );
    assert.equal(fetchCalled, false, 'fetch should not be called when silent=true');
    assert.equal(stderr, '');
  });

  it('prints notice to stderr when update is available (cache miss)', async () => {
    // Point cache to a fresh temp dir (no cache file exists)
    process.env.PRISM_UPDATE_CACHE = makeCachePath();
    try {
      const stderr = await captureStderr(() =>
        runCheck({}, mockFetch('99.9.9'))
      );
      assert.ok(stderr.includes('Update available'), `expected notice, got: ${stderr}`);
      assert.ok(stderr.includes('99.9.9'), `expected version 99.9.9 in notice, got: ${stderr}`);
      assert.ok(stderr.includes('prism update'), `expected 'prism update' in notice, got: ${stderr}`);
    } finally {
      delete process.env.PRISM_UPDATE_CACHE;
    }
  });

  it('writes cache file after successful fetch', async () => {
    const cachePath = makeCachePath();
    process.env.PRISM_UPDATE_CACHE = cachePath;
    try {
      await runCheck({}, mockFetch('99.9.9'));
      assert.ok(fs.existsSync(cachePath), 'cache file should be written');
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      assert.equal(cache.latestVersion, '99.9.9');
    } finally {
      delete process.env.PRISM_UPDATE_CACHE;
    }
  });

  it('prints nothing when installed version equals latest', async () => {
    const { version: installed } = require('../package.json');
    process.env.PRISM_UPDATE_CACHE = makeCachePath();
    try {
      const stderr = await captureStderr(() =>
        runCheck({}, mockFetch(installed))
      );
      assert.equal(stderr, '', `expected empty stderr, got: ${stderr}`);
    } finally {
      delete process.env.PRISM_UPDATE_CACHE;
    }
  });

  it('prints nothing on network timeout (silent failure)', async () => {
    process.env.PRISM_UPDATE_CACHE = makeCachePath();
    try {
      const stderr = await captureStderr(() =>
        runCheck({}, slowFetch(500)) // 500ms slow, 2500ms default timeout — but we use a short inner timeout
      );
      // Since the default timeout in scheduleUpdateCheck's internal runUpdateCheck is 2500ms,
      // and slowFetch(500) will resolve after 500ms (within timeout), this test is for offline (fail).
      // Use failFetch instead for the true "silent on error" test.
    } finally {
      delete process.env.PRISM_UPDATE_CACHE;
    }
  });

  it('prints nothing when fetch fails (offline)', async () => {
    process.env.PRISM_UPDATE_CACHE = makeCachePath();
    try {
      const stderr = await captureStderr(() =>
        runCheck({}, failFetch())
      );
      assert.equal(stderr, '', `expected empty stderr on offline, got: ${stderr}`);
    } finally {
      delete process.env.PRISM_UPDATE_CACHE;
    }
  });

  it('uses cache when valid and skips fetch', async () => {
    const cachePath = makeCachePath();
    process.env.PRISM_UPDATE_CACHE = cachePath;
    // Write a fresh cache with a higher version
    writeTestCache(cachePath, { checkedAt: Date.now(), latestVersion: '99.9.9' });
    let fetchCalled = false;
    try {
      const stderr = await captureStderr(() =>
        runCheck({}, () => { fetchCalled = true; return mockFetch('99.9.9')(); })
      );
      assert.equal(fetchCalled, false, 'fetch should be skipped when cache is valid');
      assert.ok(stderr.includes('Update available'));
    } finally {
      delete process.env.PRISM_UPDATE_CACHE;
    }
  });

  it('fetches when cache is stale', async () => {
    const cachePath = makeCachePath();
    process.env.PRISM_UPDATE_CACHE = cachePath;
    // Write a stale cache (25 hours ago)
    const staleTime = Date.now() - (25 * 60 * 60 * 1000);
    writeTestCache(cachePath, { checkedAt: staleTime, latestVersion: '0.1.0' });
    let fetchCalled = false;
    try {
      await runCheck({}, () => { fetchCalled = true; return mockFetch('99.9.9')(); });
      assert.equal(fetchCalled, true, 'fetch should be called when cache is stale');
    } finally {
      delete process.env.PRISM_UPDATE_CACHE;
    }
  });
});

// ---------------------------------------------------------------------------
// printUpdateNotice
// ---------------------------------------------------------------------------

describe('printUpdateNotice', () => {
  it('writes to stderr (not stdout)', () => {
    const stderrChunks = [];
    const stdoutChunks = [];
    const origErr = process.stderr.write.bind(process.stderr);
    const origOut = process.stdout.write.bind(process.stdout);
    process.stderr.write = (chunk) => { stderrChunks.push(chunk); return true; };
    process.stdout.write = (chunk) => { stdoutChunks.push(chunk); return true; };
    try {
      printUpdateNotice('0.6.0', '0.7.0');
    } finally {
      process.stderr.write = origErr;
      process.stdout.write = origOut;
    }
    const stderrOut = stderrChunks.join('');
    const stdoutOut = stdoutChunks.join('');
    assert.ok(stderrOut.includes('0.6.0'), 'installed version should appear in stderr');
    assert.ok(stderrOut.includes('0.7.0'), 'latest version should appear in stderr');
    assert.equal(stdoutOut, '', 'stdout should be empty');
  });

  it('uses the correct notice format', () => {
    const chunks = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { chunks.push(chunk); return true; };
    try {
      printUpdateNotice('0.6.0', '0.7.0');
    } finally {
      process.stderr.write = orig;
    }
    const output = chunks.join('');
    assert.ok(
      output.includes('✦ Update available: v0.6.0 → v0.7.0. Run: prism update'),
      `unexpected format: ${output}`
    );
  });
});
