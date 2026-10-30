/**
 * Prism — the code that proves whoever makes the first account owns this server.
 * It lives in the data directory until that account exists, so it survives restarts and
 * can be found when the log cannot.
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const FILE = 'setup-code';

/** @returns {string} */
function loadOrCreateSetupCode(dataDir) {
  const file = path.join(dataDir, FILE);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const code = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(file, `${code}\n`, { mode: 0o600 });
  return code;
}

function removeSetupCode(dataDir) {
  fs.rmSync(path.join(dataDir, FILE), { force: true });
}

/** @returns {string|null} What the data directory holds, if the first account is still to come. */
function readSetupCode(dataDir) {
  try {
    return fs.readFileSync(path.join(dataDir, FILE), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** The address to open, with the code in it. */
function setupUrl(code, { loopback }, port) {
  return `http://${loopback ? 'localhost' : '<this-machine>'}:${port}/?setup=${code}`;
}

module.exports = { loadOrCreateSetupCode, removeSetupCode, readSetupCode, setupUrl };
