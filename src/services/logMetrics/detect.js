'use strict';

/**
 * Source detection — Layer 0
 *
 * Determines which adapter to use for a given stage log.
 *
 * Priority:
 *   1. stage-N.meta.json header (explicit declaration by pipelineManager)
 *   2. First non-empty line sniffing
 *   3. Fallback to 'plain'
 */

const fs   = require('fs');
const path = require('path');
const readline = require('readline');

const { findAdapter } = require('./adapters/index');

/**
 * Read and parse stage-N.meta.json if it exists.
 *
 * @param {string} runDir
 * @param {number} stageIndex
 * @returns {object|null}
 */
function readMetaHeader(runDir, stageIndex) {
  const metaPath = path.join(runDir, `stage-${stageIndex}.meta.json`);
  try {
    const raw = fs.readFileSync(metaPath, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

/**
 * Read the first non-empty line of a file.
 *
 * @param {string} logPath
 * @returns {Promise<string>}
 */
async function readFirstLine(logPath) {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(logPath, { encoding: 'utf8', highWaterMark: 4096 });
    const rl     = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let found = false;

    rl.on('line', (line) => {
      if (!found && line.trim()) {
        found = true;
        rl.close();
        stream.destroy();
        resolve(line.trim());
      }
    });

    rl.on('close', () => {
      if (!found) resolve('');
    });

    stream.on('error', () => resolve(''));
  });
}

/**
 * Detect the source tool and return the matching adapter.
 *
 * @param {string} runDir
 * @param {number} stageIndex
 * @param {string} logPath
 * @returns {Promise<{adapter: object, header: object|null}>}
 */
async function detectAdapter(runDir, stageIndex, logPath) {
  const header    = readMetaHeader(runDir, stageIndex);
  const firstLine = await readFirstLine(logPath);
  const adapter   = findAdapter(firstLine, header);
  return { adapter, header };
}

module.exports = { detectAdapter, readMetaHeader, readFirstLine };
