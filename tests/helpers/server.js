'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('../../server');

/**
 * Start an isolated test server with a temporary data directory.
 *
 * @returns {Promise<{ port: number, close: Function }>}
 */
function startTestServer() {
  return new Promise((resolve, reject) => {
    const tmpDir    = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-test-'));
    const runsDir = path.join(tmpDir, 'runs');

    const prevRunsDir = process.env.PIPELINE_RUNS_DIR;
    process.env.PIPELINE_RUNS_DIR = runsDir;

    const server = startServer({ port: 0, dataDir: tmpDir, silent: true });

    server.once('listening', () => {
      const port = server.address().port;

      function close() {
        return new Promise((res) => {
          // closeAllConnections() drops keep-alive sockets immediately so
          // server.close() doesn't hang waiting for them to time out.
          if (typeof server.closeAllConnections === 'function') {
            server.closeAllConnections();
          }
          server.close(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            // Restore env vars so parallel test files don't interfere.
            if (prevRunsDir === undefined) {
              delete process.env.PIPELINE_RUNS_DIR;
            } else {
              process.env.PIPELINE_RUNS_DIR = prevRunsDir;
            }
            res();
          });
        });
      }

      resolve({ port, store: server._store, close });
    });

    server.once('error', (err) => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      reject(err);
    });
  });
}

module.exports = { startTestServer };
