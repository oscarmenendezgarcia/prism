'use strict';

/**
 * Harness discovery handler — GET /api/v1/harnesses
 *
 * Reports which CLI harnesses (claude / opencode / pi / hermes) are installed on
 * this machine and where, so the UI can mark the ones that aren't available as
 * disabled (with a link to install them).
 *
 * `custom` is intentionally excluded: it is a pipeline-stage-only shell-command
 * template (no single binary), not a direct-spawn harness.
 *
 * Routes:
 *   GET /api/v1/harnesses   → handleGetHarnesses
 */

const { sendJSON } = require('../utils/http');
const cliSpawn = require('../services/cliSpawn');

// Static harness descriptors. `modelFormat` mirrors the routing model each
// harness consumes; `installUrl` is where a user installs/gets started.
const HARNESSES = [
  {
    cliTool:     'claude',
    modelFormat: 'preset',
    installUrl:  'https://www.anthropic.com/product/claude-code',
  },
  {
    cliTool:     'opencode',
    modelFormat: 'provider/model',
    installUrl:  'https://opencode.ai/',
  },
  {
    cliTool:     'pi',
    modelFormat: 'provider/model',
    installUrl:  'https://pi.dev/',
  },
  {
    cliTool:     'hermes',
    modelFormat: 'provider/model',
    installUrl:  'https://hermes-agent.nousresearch.co/',
  },
];

/**
 * GET /api/v1/harnesses
 * Resolve each harness binary and report availability + path.
 */
function handleGetHarnesses(req, res) {
  const harnesses = HARNESSES.map((h) => {
    let available = false;
    let path = null;
    try {
      const resolved = cliSpawn.resolveCliBinary(h.cliTool);
      if (resolved && resolved !== h.cliTool) {
        available = true;
        path = resolved;
      }
    } catch {
      available = false;
    }
    return { ...h, available, path };
  });
  return sendJSON(res, 200, { harnesses });
}

module.exports = { handleGetHarnesses };
