'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('../../server');

/**
 * Start an isolated test server with a temporary data directory.
 * The server listens on a random OS-assigned port.
 *
 * @returns {Promise<{ port: number, close: Function }>}
 */
function startTestServer() {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-test-'));
    const server = startServer({ port: 0, dataDir: tmpDir, silent: true });

    server.once('listening', () => {
      const port = server.address().port;

      function close() {
        return new Promise((res) => {
          server.close(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            res();
          });
        });
      }

      resolve({ port, close });
    });

    server.once('error', (err) => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      reject(err);
    });
  });
}

module.exports = { startTestServer };
