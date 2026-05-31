/**
 * Folio — Standalone stdio MCP Server (folio-mcp-server.js)
 *
 * The `folio mcp` runtime described in .folio/mcp-tools/uso-standalone.md.
 * Discovers the .folio/ directory by walking up from process.cwd(), builds a
 * FolioService over the file backend, registers all 11 Folio tools, and serves
 * over StdioServerTransport (Claude Code / Cursor / Windsurf manage the
 * process lifecycle).
 *
 * All logging goes to STDERR — stdout is reserved for the MCP protocol.
 * One structured log line per tool invocation: { tool, folioId, ok, ms }.
 * Backend kind + resolved .folio/ path logged once at startup.
 *
 * Usage:
 *   node mcp/folio-mcp-server.js
 *   # or add to your MCP client config:
 *   # { "command": "node", "args": ["/path/to/prism/mcp/folio-mcp-server.js"] }
 */

import { McpServer }          from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire }       from 'module';

// The core (CJS) modules are imported via createRequire since mcp/ is ESM
// but src/ uses CJS ('use strict' + require()).
const require = createRequire(import.meta.url);

const { createFolioService, openFileBackend } = require('../src/services/folio/index.js');

import { registerFolioTools } from './folio-tools.js';

// ---------------------------------------------------------------------------
// Structured stderr logger (stdout is reserved for MCP protocol frames)
// ---------------------------------------------------------------------------

function log(obj) {
  process.stderr.write(JSON.stringify(obj) + '\n');
}

// ---------------------------------------------------------------------------
// Instrument: wrap each tool call to emit { tool, folioId, ok, ms } logs
// ---------------------------------------------------------------------------

/**
 * Wrap registerFolioTools so every tool call emits a structured log line.
 * We intercept server.tool() to add a timing/logging wrapper around the
 * handler without modifying folio-tools.js itself.
 *
 * @param {McpServer} server
 * @param {object}    service
 */
function registerFolioToolsWithLogging(server, service) {
  // Proxy the server so we can wrap handlers before passing to the real server.tool()
  const proxy = {
    tool(name, description, schema, handler) {
      const wrappedHandler = async (args) => {
        const start = Date.now();
        let success = true;
        try {
          const result = await handler(args);
          if (result && result.isError) success = false;
          return result;
        } catch (e) {
          success = false;
          throw e;
        } finally {
          log({
            tool:    name,
            folioId: args && args.folioId ? args.folioId : undefined,
            ok:      success,
            ms:      Date.now() - start,
          });
        }
      };
      server.tool(name, description, schema, wrappedHandler);
    },
  };

  registerFolioTools(proxy, service);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Discover .folio/ backend from cwd
  let backend;
  try {
    backend = openFileBackend({ cwd: process.cwd() });
  } catch (e) {
    log({ event: 'startup_error', error: e.message });
    process.exit(1);
  }

  log({
    event:       'startup',
    backendKind: backend.kind,
    folioRoot:   backend.root ?? '(n/a)',
  });

  const service = createFolioService(backend);

  const server = new McpServer({
    name:    'folio',
    version: '1.0.0',
  });

  registerFolioToolsWithLogging(server, service);

  const transport = new StdioServerTransport();

  // Clean exit on transport close
  transport.onclose = () => {
    log({ event: 'transport_closed' });
    try { service.close(); } catch (_) {}
    process.exit(0);
  };

  await server.connect(transport);

  log({ event: 'ready', tools: 11 });
}

main().catch((e) => {
  log({ event: 'fatal', error: e.message, stack: e.stack });
  process.exit(1);
});
