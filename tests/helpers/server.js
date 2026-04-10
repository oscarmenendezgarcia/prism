'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { startServer } = require('../../server');

/**
 * Starts an isolated Prism server on a random port with a temporary data
 * directory. Returns { port, close } where close() shuts the server down and
 * deletes the temp directory.
 *
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
function startTestServer() {
  return new Promise((resolve, reject) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-test-'));

    const server = startServer({ port: 0, dataDir, silent: true });

    server.once('error', (err) => {
      fs.rmSync(dataDir, { recursive: true, force: true });
      reject(err);
    });

    server.once('listening', () => {
      const port = server.address().port;

      function close() {
        return new Promise((res) => {
          server.close(() => {
            fs.rmSync(dataDir, { recursive: true, force: true });
            res();
          });
        });
      }

      resolve({ port, close });
    });
  });
}

module.exports = { startTestServer };
