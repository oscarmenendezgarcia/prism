#!/usr/bin/env node
'use strict';

/**
 * bin/prepare.js — npm `prepare` lifecycle hook
 *
 * Runs `npm ci && npm run build` inside frontend/ to produce dist/.
 * Fast-path: skips the build when dist/index.html exists AND its mtime is
 * newer than all source files checked (frontend/src/**, frontend/index.html,
 * frontend/vite.config.ts, frontend/package-lock.json).
 *
 * This makes `npm install` from a git checkout fast for contributors who
 * already have a fresh dist/, while guaranteeing a full build on `npm publish`.
 */

const path             = require('path');
const fs               = require('fs');
const { spawnSync }    = require('child_process');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT        = path.resolve(__dirname, '..');
const FRONTEND    = path.join(ROOT, 'frontend');
const DIST_INDEX  = path.join(ROOT, 'dist', 'index.html');

// Files / directories whose mtime controls whether we rebuild
const SOURCE_ROOTS = [
  path.join(FRONTEND, 'src'),
  path.join(FRONTEND, 'index.html'),
  path.join(FRONTEND, 'vite.config.ts'),
  path.join(FRONTEND, 'package-lock.json'),
];

// ---------------------------------------------------------------------------
// mtime helpers
// ---------------------------------------------------------------------------

/**
 * Return the most recent mtime (ms since epoch) for a file or directory tree.
 * Returns 0 if the path does not exist.
 */
function latestMtime(target) {
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      let max = stat.mtimeMs;
      for (const entry of fs.readdirSync(target)) {
        const child = latestMtime(path.join(target, entry));
        if (child > max) max = child;
      }
      return max;
    }
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Fast-path check
// ---------------------------------------------------------------------------

function isDistFresh() {
  let distMtime;
  try {
    distMtime = fs.statSync(DIST_INDEX).mtimeMs;
  } catch {
    return false; // dist/index.html does not exist → must build
  }

  const sourceMtime = Math.max(...SOURCE_ROOTS.map(latestMtime));
  return distMtime > sourceMtime;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function runInFrontend(command, args) {
  const result = spawnSync(command, args, {
    cwd:   FRONTEND,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    process.stderr.write(`[prepare] Failed to run '${command} ${args.join(' ')}': ${result.error.message}\n`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.stderr.write(`[prepare] '${command} ${args.join(' ')}' exited with code ${result.status}\n`);
    process.exit(result.status || 1);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

if (isDistFresh()) {
  console.log('[prepare] dist/ up-to-date — skipping');
  process.exit(0);
}

console.log('[prepare] Building frontend...');

// npm ci — install exact lockfile deps
runInFrontend('npm', ['ci']);

// npm run build — Vite production build → ../dist/
runInFrontend('npm', ['run', 'build']);

console.log('[prepare] Frontend build complete.');
