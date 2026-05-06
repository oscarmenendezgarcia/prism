'use strict';

/**
 * Adapter registry
 *
 * Maps source names to their adapter implementations.
 * To add a new tool (e.g. opencode), create adapters/opencode.js and add it here.
 *
 * Detection order:
 *   1. claude-code  — if meta.json says source='claude-code', OR first line is stream-json
 *   2. plain        — fallback (always matches)
 */

const claudeCodeAdapter = require('./claudeCode');
const plainTextAdapter  = require('./plainText');

/**
 * Ordered list of adapters. Detection is tried in this order; the first match wins.
 * plainText must be last (it is the unconditional fallback).
 *
 * @type {Array<{name: string, detect: Function, parse: Function}>}
 */
const ADAPTERS = [
  claudeCodeAdapter,
  plainTextAdapter,
];

/**
 * Find the appropriate adapter for a given log file.
 *
 * @param {string}      firstLine - First non-empty line of the log.
 * @param {object|null} header    - Contents of stage-N.meta.json, or null.
 * @returns {{name: string, detect: Function, parse: Function}}
 */
function findAdapter(firstLine, header) {
  for (const adapter of ADAPTERS) {
    if (adapter.detect(firstLine, header)) {
      return adapter;
    }
  }
  // Should never reach here because plainText always returns true.
  return plainTextAdapter;
}

module.exports = {
  ADAPTERS,
  findAdapter,
};
