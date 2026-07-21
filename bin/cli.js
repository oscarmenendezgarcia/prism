#!/usr/bin/env node
'use strict';

/**
 * bin/cli.js — prism CLI entry point
 *
 * Subcommands:
 *   prism start   [--port <n>] [--data-dir <path>] [--silent]
 *   prism stop    [--data-dir <path>] [--force]
 *   prism init    [--data-dir <path>] [--force]
 *   prism update  [--no-update-check]
 *   prism doctor  [--data-dir <path>] [--json]
 *   prism run list
 *   prism run <runId> [logs [-f]]
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
  prism stop    [--data-dir <path>] [--force]
  prism init    [--data-dir <path>] [--force]
  prism update
  prism doctor  [--data-dir <path>] [--json]
  prism run list                       List last 10 pipeline runs
  prism run <runId>                    Alias for 'run <runId> logs'
  prism run <runId> logs [-f]          Print (or follow with -f) stage logs
  prism --version
  prism --help

Options shared across subcommands:
  --data-dir <path>     Override the data directory (env: DATA_DIR)
  --silent              Suppress informational output
  --force               (stop) Send SIGKILL immediately; (init) overwrite existing settings.json
  --no-update-check     Skip the startup version check (env: PRISM_NO_UPDATE_CHECK)

prism start options:
  --port <n>            Port to listen on (default 3000, env: PORT)

prism stop:
  Reads <dataDir>/prism.pid, sends SIGTERM, and waits up to 35s for the
  process to exit. Use --force to send SIGKILL immediately (bypasses graceful
  shutdown — use when the server is hung).

prism doctor:
  Checks Node.js version, node-pty spawn-helper, better-sqlite3, Claude CLI,
  data-dir writability, and server status. Exit 0 if all pass, 1 if any fail.
  --json                Print machine-readable JSON instead of text

prism update:
  Fetches the latest version from npm and installs it globally.
  Prompts for confirmation (auto-confirms in non-TTY/CI environments).

prism run:
  Inspect pipeline runs from the terminal (reads data/runs/ directly, falls
  back to the HTTP API when --server-url is passed).

    prism run list                       Print last N run summaries (default 10)
    prism run list --limit <n>           Change the summary list size (max 100)
    prism run <runId>                    Alias for run <runId> logs
    prism run <runId> logs               Print all stage logs with headers
    prism run <runId> logs -f            Follow (Ctrl+C exits with 130)
    prism run <runId> logs --stage <n>   Print only stage <n>

  runId is matched by prefix (≥ 8 hex chars). Ambiguous prefixes exit 2 with a
  list of candidates. Additional flags:
    --poll-ms <n>       Follow-mode poll interval (default 500, range 50..10000)
    --server-url <url>  Force the HTTP fallback path (e.g. http://localhost:3000)
`.trim();

// ---------------------------------------------------------------------------
// Minimal argv parser — no third-party deps
// ---------------------------------------------------------------------------

// Value-taking flags shared by both "--flag value" and "--flag=value" forms.
const VALUE_FLAGS = {
  '--limit':      'limit',
  '--poll-ms':    'pollMs',
  '--stage':      'stage',
  '--server-url': 'serverUrl',
};

// Returns the part of `arg` before its first "=", or `arg` itself if there is none.
function eqPrefix(arg) {
  const idx = arg.indexOf('=');
  return idx === -1 ? arg : arg.slice(0, idx);
}

/**
 * Parse process.argv into { subcommand, flags, positional }.
 * Supports:
 *   --flag value
 *   --flag=value
 *   --boolean-flag
 *
 * `positional` contains every non-flag argument in order (including the
 * subcommand at index 0). `subcommand` mirrors positional[0] for backwards
 * compatibility with the existing switch/case.
 */
function parseArgv(argv) {
  const args = argv.slice(2); // strip node + script path
  const flags = {};
  const positional = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--version' || arg === '-v') {
      flags.version = true;
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--silent') {
      flags.silent = true;
    } else if (arg === '--no-update-check') {
      flags.noUpdateCheck = true;
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
    } else if (arg === '--json') {
      flags.json = true;
    } else if (arg === '--follow' || arg === '-f') {
      flags.follow = true;
    } else if (arg in VALUE_FLAGS) {
      flags[VALUE_FLAGS[arg]] = args[++i];
    } else if (eqPrefix(arg) in VALUE_FLAGS) {
      flags[VALUE_FLAGS[eqPrefix(arg)]] = arg.slice(eqPrefix(arg).length + 1);
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    } else if (arg.startsWith('-')) {
      // Unknown flag — warn but do not hard-fail here; subcommand handler decides
      process.stderr.write(`Warning: unknown flag '${arg}'\n`);
    }

    i++;
  }

  return { subcommand: positional[0] || null, flags, positional };
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

function runStop(flags) {
  require(path.join(__dirname, 'stop.js')).run(flags).catch(err => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
}

function runUpdate(flags) {
  require(path.join(__dirname, 'update.js')).run(flags);
}

function runDoctor(flags) {
  require(path.join(__dirname, 'doctor.js')).run(flags);
}

function runRun(flags, positional) {
  // positional[0] === 'run'; forward the rest to the dispatcher
  require(path.join(__dirname, 'run.js'))
    .run(flags, positional.slice(1))
    .catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(err && Number.isInteger(err.exitCode) ? err.exitCode : 1);
    });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// Exported for unit testing
module.exports = { parseArgv };

if (require.main !== module) return;

(function main() {
  const { subcommand, flags, positional } = parseArgv(process.argv);

  // Apply env var equivalent for --no-update-check
  if (process.env.PRISM_NO_UPDATE_CHECK) {
    flags.noUpdateCheck = true;
  }

  if (flags.version) {
    process.stdout.write(`${version}\n`);
    process.exit(0);
  }

  if (flags.help || subcommand === 'help') {
    process.stdout.write(USAGE + '\n');
    process.exit(0);
  }

  // Fire-and-forget version check — must not block the main command
  const { scheduleUpdateCheck } = require(path.join(__dirname, 'update-check.js'));
  scheduleUpdateCheck(flags);

  switch (subcommand) {
    case 'start':
      runStart(flags);
      break;

    case 'stop':
      runStop(flags);
      break;

    case 'init':
      runInit(flags);
      break;

    case 'update':
      runUpdate(flags);
      break;

    case 'doctor':
      runDoctor(flags);
      break;

    case 'run':
      runRun(flags, positional);
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
