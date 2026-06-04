/**
 * Folio — Standalone stdio MCP Server (folio-mcp-server.js)
 *
 * The `folio mcp` runtime described in .folio/mcp-tools/standalone-usage.md.
 *
 * MULTI-FOLIO: the server is NOT pinned to a single folio. It exposes a
 * per-root service resolver — every tool accepts an optional `folioRoot` and the
 * server opens/caches a FolioService for that root on demand. One server process
 * serves any .folio/ on disk; no restart/reconnect to switch folios. When a tool
 * omits folioRoot, the server's startup directory (process.cwd()) is used as the
 * default, preserving the simple "cd into your repo" experience.
 *
 * All logging goes to STDERR — stdout is reserved for the MCP protocol.
 * One structured log line per tool invocation: { tool, folioId, ok, ms }.
 * Each newly-opened root is logged once.
 *
 * Usage:
 *   node mcp/folio-mcp-server.js
 *   # or add to your MCP client config:
 *   # { "command": "node", "args": ["/path/to/prism/mcp/folio-mcp-server.js"] }
 */

import { McpServer }            from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire }        from 'module';
import path                     from 'path';

// The core (CJS) modules are imported via createRequire since mcp/ is ESM
// but src/ uses CJS ('use strict' + require()).
const require = createRequire(import.meta.url);

const { createFolioService, openFileBackend } = require('../src/services/folio/index.js');
const { maxMarkdownMtime } = require('../src/services/folio/backend.js');

import { registerFolioTools } from './folio-tools.js';

// ---------------------------------------------------------------------------
// Structured stderr logger (stdout is reserved for MCP protocol frames)
// ---------------------------------------------------------------------------

function log(obj) {
  process.stderr.write(JSON.stringify(obj) + '\n');
}

// ---------------------------------------------------------------------------
// Per-root service resolver + cache (multi-folio)
// ---------------------------------------------------------------------------

/**
 * Build a `(folioRoot?) => FolioService` resolver backed by a per-root cache.
 * A directory named `.folio` is opened as an explicit root; any other directory
 * is used as a discovery cwd (walk up to find the nearest `.folio/`).
 *
 * @returns {{ resolve: (folioRoot?: string) => object, closeAll: () => void }}
 */
function makeResolver() {
  const cache = new Map();

  function openAt(dir) {
    const opts = path.basename(dir) === '.folio' ? { root: dir } : { cwd: dir };
    return createFolioService(openFileBackend(opts));
  }

  function resolve(folioRoot) {
    const key = folioRoot ? path.resolve(folioRoot) : process.cwd();
    const entry = cache.get(key);

    if (entry) {
      // The service caches an in-memory index hydrated from the .md files. Reuse
      // it unless the .folio/ changed on disk since we hydrated (external edit,
      // git pull, the Prism server, or our own previous write) — otherwise we'd
      // serve stale content. The freshness check is a cheap stat-walk; only a
      // real change triggers a re-hydrate.
      let currentMtime = entry.mtime;
      try { currentMtime = maxMarkdownMtime(entry.root); } catch (_) { /* keep cached */ }
      if (currentMtime <= entry.mtime) {
        return entry.service;
      }
      try { entry.service.close(); } catch (_) { /* best-effort */ }
      cache.delete(key);
      log({ event: 'rehydrate', root: entry.root, reason: 'markdown changed on disk' });
    }

    const service = openAt(key); // throws if no .folio/ is found — surfaced to the caller
    const root    = (service.backend && service.backend.root) || key;
    let mtime = 0;
    try { mtime = maxMarkdownMtime(root); } catch (_) { /* leave 0 → next call re-checks */ }
    cache.set(key, { service, root, mtime });
    log({
      event:       'open',
      root:        key,
      backendKind: service.backend && service.backend.kind,
      folioRoot:   root || '(n/a)',
    });
    return service;
  }

  function closeAll() {
    for (const entry of cache.values()) {
      try { entry.service.close(); } catch (_) { /* best-effort */ }
    }
    cache.clear();
  }

  return { resolve, closeAll };
}

// ---------------------------------------------------------------------------
// Instrument: wrap each tool call to emit { tool, folioId, ok, ms } logs
// ---------------------------------------------------------------------------

/**
 * Wrap registerFolioTools so every tool call emits a structured log line.
 * Intercepts server.tool() to add a timing/logging wrapper around the handler
 * without modifying folio-tools.js itself.
 *
 * @param {McpServer} server
 * @param {Function}  resolver  `(folioRoot?) => FolioService`
 */
function registerFolioToolsWithLogging(server, resolver) {
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
            tool:      name,
            folioId:   args && args.folioId ? args.folioId : undefined,
            folioRoot: args && args.folioRoot ? args.folioRoot : undefined,
            ok:        success,
            ms:        Date.now() - start,
          });
        }
      };
      server.tool(name, description, schema, wrappedHandler);
    },
  };

  registerFolioTools(proxy, resolver);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { resolve, closeAll } = makeResolver();

  // Probe the default folio (startup cwd) for a friendly startup log. A missing
  // default is NOT fatal — multi-folio means callers can target other roots.
  try {
    const def = resolve(undefined);
    log({
      event:       'startup',
      multiFolio:  true,
      backendKind: def.backend && def.backend.kind,
      defaultRoot: (def.backend && def.backend.root) || '(n/a)',
    });
  } catch (e) {
    log({ event: 'startup', multiFolio: true, defaultFolio: 'none', note: e.message });
  }

  const server = new McpServer({
    name:    'folio',
    version: '1.0.0',
  });

  registerFolioToolsWithLogging(server, resolve);

  const transport = new StdioServerTransport();

  // Clean exit on transport close — close every cached service.
  transport.onclose = () => {
    log({ event: 'transport_closed' });
    closeAll();
    process.exit(0);
  };

  await server.connect(transport);

  log({ event: 'ready', tools: 13, multiFolio: true });
}

main().catch((e) => {
  log({ event: 'fatal', error: e.message, stack: e.stack });
  process.exit(1);
});
