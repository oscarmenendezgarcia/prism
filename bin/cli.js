#!/usr/bin/env node
'use strict';

/**
 * bin/cli.js — prism CLI entry point
 *
 * Subcommands:
 *   prism start  [--port <n>]      [--data-dir <path>] [--silent]
 *   prism init   [--data-dir <path>] [--force]
 *   prism --version
 *   prism --help
 *
 * Exit codes:
 *   0  — success
 *   1  — runtime error
 *   2  — usage error (unknown subcommand / bad flags)
 */

const path    = require('path');
const { version } = require(path.join(__dirname, '..', 'package.json'));

// ---------------------------------------------------------------------------
// Usage text
// ---------------------------------------------------------------------------

const USAGE = `
prism — local-first kanban + agent pipeline runner

Usage:
  prism start   [--port <n>] [--data-dir <path>] [--silent]
  prism init    [--data-dir <path>] [--force]
  prism --version
  prism --help

Options shared across subcommands:
  --data-dir <path>   Override the data directory (env: DATA_DIR)
  --silent            Suppress informational output
  --force             (init only) Overwrite existing settings.json

prism start options:
  --port <n>          Port to listen on (default 3000, env: PORT)
`.trim();

// ---------------------------------------------------------------------------
// Minimal argv parser — no third-party deps
// ---------------------------------------------------------------------------

/**
 * Parse process.argv into { subcommand, flags }.
 * Supports:
 *   --flag value
 *   --flag=value
 *   --boolean-flag
 */
function parseArgv(argv) {
  const args = argv.slice(2); // strip node + script path
  const flags = {};
  let subcommand = null;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--version' || arg === '-v') {
      flags.version = true;
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--silent') {
      flags.silent = true;
    } else if (arg === '--force') {
      flags.force = true;
    } else if (arg.startsWith('--port=')) {
      flags.port = arg.slice('--port='.length);
    } else if (arg === '--port') {
      flags.port = args[++i];
    } else if (arg.startsWith('--data-dir=')) {
      flags.dataDir = arg.slice('--data-dir='.length);
    } else if (arg === '--data-dir') {
      flags.dataDir = args[++i];
    } else if (!arg.startsWith('-') && subcommand === null) {
      subcommand = arg;
    } else if (arg.startsWith('-')) {
      // Unknown flag — warn but do not hard-fail here; subcommand handler decides
      process.stderr.write(`Warning: unknown flag '${arg}'\n`);
    }

    i++;
  }

  return { subcommand, flags };
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

function runStart(flags) {
  // Propagate --data-dir into env so resolveDataDir() sees it inside server.js
  if (flags.dataDir) {
    process.env.DATA_DIR = flags.dataDir;
  }

  const port = flags.port !== undefined ? parseInt(flags.port, 10) : undefined;

  if (port !== undefined && isNaN(port)) {
    process.stderr.write(`Error: --port must be a number, got '${flags.port}'\n`);
    process.exit(2);
  }

  const { startServer }              = require(path.join(__dirname, '..', 'server.js'));
  const { setupTerminalWebSocket }   = require(path.join(__dirname, '..', 'terminal.js'));
  const { getActiveProcessCount }    = require(path.join(__dirname, '..', 'src', 'services', 'pipelineManager.js'));

  const server = startServer({
    port:    port,
    silent:  flags.silent || false,
  });

  setupTerminalWebSocket(server);

  // Graceful shutdown
  function gracefulShutdown(signal) {
    if (!flags.silent) {
      console.log(`\n[server] ${signal} received — starting graceful shutdown...`);
    }
    server.close(() => {
      if (!flags.silent) console.log('[server] HTTP server closed.');
    });

    const store = server._store;
    try { if (store) store.close(); } catch { /* ignore */ }

    const active = typeof getActiveProcessCount === 'function' ? getActiveProcessCount() : 0;
    if (active === 0) {
      process.exit(0);
      return;
    }

    if (!flags.silent) {
      console.log(`[server] Waiting for ${active} active pipeline run(s) to finish (max 30s)...`);
    }

    const deadline = setTimeout(() => {
      console.warn('[server] Deadline reached — forcing exit.');
      process.exit(1);
    }, 30_000);
    deadline.unref();

    const poll = setInterval(() => {
      const remaining = typeof getActiveProcessCount === 'function' ? getActiveProcessCount() : 0;
      if (remaining === 0) {
        clearInterval(poll);
        process.exit(0);
      }
    }, 500);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
}

function runInit(flags) {
  require(path.join(__dirname, 'init.js')).run(flags);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

(function main() {
  const { subcommand, flags } = parseArgv(process.argv);

  if (flags.version) {
    process.stdout.write(`${version}\n`);
    process.exit(0);
  }

  if (flags.help || subcommand === 'help') {
    process.stdout.write(USAGE + '\n');
    process.exit(0);
  }

  switch (subcommand) {
    case 'start':
      runStart(flags);
      break;

    case 'init':
      runInit(flags);
      break;

    case null:
      // No subcommand — print help and exit cleanly
      process.stdout.write(USAGE + '\n');
      process.exit(0);
      break;

    default:
      process.stderr.write(`Error: unknown subcommand '${subcommand}'\n\n`);
      process.stderr.write(USAGE + '\n');
      process.exit(2);
  }
})();
