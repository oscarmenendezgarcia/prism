#!/usr/bin/env node
'use strict';

/**
 * bin/postinstall.js — npm `postinstall` lifecycle hook
 *
 * Ensures node-pty's spawn-helper binary is executable on Unix platforms.
 * npm does not preserve the executable bit on prebuilt binaries during
 * global installs, which causes `posix_spawnp failed` at runtime.
 */

const path = require('path');
const fs   = require('fs');

if (process.platform === 'win32') process.exit(0);

const ptyDir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds',
  `${process.platform}-${process.arch}`);
const helper = path.join(ptyDir, 'spawn-helper');

try {
  fs.accessSync(helper, fs.constants.F_OK);
} catch {
  // Not installed yet (e.g. optional dep skipped) — silently skip.
  process.exit(0);
}

try {
  const stat = fs.statSync(helper);
  const isExecutable = (stat.mode & 0o111) !== 0;
  if (!isExecutable) {
    fs.chmodSync(helper, stat.mode | 0o111);
    console.log('[postinstall] Fixed node-pty spawn-helper permissions (+x)');
  }
} catch (err) {
  // Non-fatal — warn and continue. The runtime fix in terminal.js is a fallback.
  console.warn(`[postinstall] Could not fix spawn-helper permissions: ${err.message}`);
}
