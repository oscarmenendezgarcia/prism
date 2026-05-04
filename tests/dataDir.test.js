'use strict';

/**
 * Unit tests for src/utils/dataDir.js
 *
 * Covers all four resolution branches:
 *   1. DATA_DIR env var set           → mode: 'env'
 *   2. .git present at packageRoot    → mode: 'dev'
 *   3. XDG_DATA_HOME set              → mode: 'xdg'
 *   4. Home fallback                  → mode: 'home'
 *
 * Run with: node --test tests/dataDir.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const { resolveDataDir } = require('../src/utils/dataDir');

// ---------------------------------------------------------------------------
// Helpers — create temporary directories for .git probing
// ---------------------------------------------------------------------------

let tmpDir;

function makeTmpDir(suffix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `prism-test-${suffix}-`));
}

describe('resolveDataDir', () => {
  before(() => {
    tmpDir = makeTmpDir('root');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Branch 1 — DATA_DIR env var
  // -------------------------------------------------------------------------
  it('should return DATA_DIR from env when set (mode=env)', () => {
    const result = resolveDataDir({
      env:         { DATA_DIR: '/custom/data/path' },
      packageRoot: tmpDir,
      homedir:     '/home/user',
    });

    assert.equal(result.path, '/custom/data/path');
    assert.equal(result.mode, 'env');
  });

  it('should prefer DATA_DIR over .git presence', () => {
    // Create a fake .git dir inside tmpDir
    const repoDir = makeTmpDir('withgit');
    try {
      fs.mkdirSync(path.join(repoDir, '.git'));

      const result = resolveDataDir({
        env:         { DATA_DIR: '/explicit/override' },
        packageRoot: repoDir,
        homedir:     '/home/user',
      });

      assert.equal(result.path, '/explicit/override');
      assert.equal(result.mode, 'env');
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Branch 2 — .git presence (dev checkout)
  // -------------------------------------------------------------------------
  it('should use <packageRoot>/data when .git exists (mode=dev)', () => {
    const repoDir = makeTmpDir('devcheckout');
    try {
      fs.mkdirSync(path.join(repoDir, '.git'));

      const result = resolveDataDir({
        env:         {},
        packageRoot: repoDir,
        homedir:     '/home/user',
      });

      assert.equal(result.path, path.join(repoDir, 'data'));
      assert.equal(result.mode, 'dev');
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('should not use dev mode when .git does not exist at packageRoot', () => {
    const noGitDir = makeTmpDir('nogit');
    try {
      const result = resolveDataDir({
        env:         {},
        packageRoot: noGitDir,
        homedir:     '/home/user',
      });

      // Must fall through to xdg or home
      assert.notEqual(result.mode, 'dev');
    } finally {
      fs.rmSync(noGitDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Branch 3 — XDG_DATA_HOME
  // -------------------------------------------------------------------------
  it('should use $XDG_DATA_HOME/prism when XDG_DATA_HOME is set (mode=xdg)', () => {
    const noGitDir = makeTmpDir('xdg');
    try {
      const result = resolveDataDir({
        env:         { XDG_DATA_HOME: '/xdg/data' },
        packageRoot: noGitDir,
        homedir:     '/home/user',
      });

      assert.equal(result.path, '/xdg/data/prism');
      assert.equal(result.mode, 'xdg');
    } finally {
      fs.rmSync(noGitDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Branch 4 — Home fallback
  // -------------------------------------------------------------------------
  it('should use ~/.local/share/prism as home fallback (mode=home)', () => {
    const noGitDir = makeTmpDir('home');
    try {
      const result = resolveDataDir({
        env:         {},
        packageRoot: noGitDir,
        homedir:     '/home/testuser',
      });

      assert.equal(result.path, '/home/testuser/.local/share/prism');
      assert.equal(result.mode, 'home');
    } finally {
      fs.rmSync(noGitDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Return shape
  // -------------------------------------------------------------------------
  it('should always return an object with { path: string, mode: string }', () => {
    const noGitDir = makeTmpDir('shape');
    try {
      const result = resolveDataDir({
        env:         {},
        packageRoot: noGitDir,
        homedir:     '/home/user',
      });

      assert.ok(typeof result.path === 'string', 'path must be a string');
      assert.ok(result.path.length > 0, 'path must not be empty');
      assert.ok(['env', 'dev', 'xdg', 'home'].includes(result.mode), `unexpected mode: ${result.mode}`);
    } finally {
      fs.rmSync(noGitDir, { recursive: true, force: true });
    }
  });
});
