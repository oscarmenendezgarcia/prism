'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('../../server');

// Agents that pipeline tests reference by ID.
const STUB_AGENTS = [
  'senior-architect',
  'ux-api-designer',
  'developer-agent',
  'qa-engineer-e2e',
];

/**
 * Start an isolated test server with a temporary data directory.
 * Also creates a temporary agents directory with stub .md files and points
 * PIPELINE_AGENTS_DIR at it, so pipeline tests work without ~/.claude/agents/.
 *
 * @returns {Promise<{ port: number, close: Function }>}
 */
function startTestServer() {
  return new Promise((resolve, reject) => {
    const tmpDir    = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-test-'));
    const agentsDir = path.join(tmpDir, 'agents');
    fs.mkdirSync(agentsDir);

    for (const agent of STUB_AGENTS) {
      fs.writeFileSync(
        path.join(agentsDir, `${agent}.md`),
        `# ${agent}\nStub agent for tests.\n`,
      );
    }

    const runsDir = path.join(tmpDir, 'runs');

    // Point pipelineManager at the stub agents and runs directories.
    // Both env vars are saved and restored on close so leaked values from
    // previous test runs don't cause path mismatches (seedRun vs. server).
    const prevAgentsDir = process.env.PIPELINE_AGENTS_DIR;
    const prevRunsDir   = process.env.PIPELINE_RUNS_DIR;
    const prevNoSpawn   = process.env.PIPELINE_NO_SPAWN;
    process.env.PIPELINE_AGENTS_DIR = agentsDir;
    process.env.PIPELINE_RUNS_DIR   = runsDir;
    // SAFETY: always prevent real claude agent spawning in test servers.
    // Without this guard, a stage spawned by executeNextStage would launch a
    // real claude process that uses the MCP config's KANBAN_API_URL (port 3000),
    // causing it to interact with the production kanban using phantom space/task
    // IDs from the isolated test DB — the "surrogate task" bug (f3149d95).
    process.env.PIPELINE_NO_SPAWN   = '1';

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
            if (prevAgentsDir === undefined) {
              delete process.env.PIPELINE_AGENTS_DIR;
            } else {
              process.env.PIPELINE_AGENTS_DIR = prevAgentsDir;
            }
            if (prevRunsDir === undefined) {
              delete process.env.PIPELINE_RUNS_DIR;
            } else {
              process.env.PIPELINE_RUNS_DIR = prevRunsDir;
            }
            if (prevNoSpawn === undefined) {
              delete process.env.PIPELINE_NO_SPAWN;
            } else {
              process.env.PIPELINE_NO_SPAWN = prevNoSpawn;
            }
            res();
          });
        });
      }

      resolve({ port, agentsDir, close });
    });

    server.once('error', (err) => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      reject(err);
    });
  });
}

module.exports = { startTestServer };
