/**
 * Prism — Hook Runner
 *
 * Runs a space's command hook when an agent finishes a task. The command comes
 * from the space's settings and runs in the task's worktree, in a shell, with the
 * same privileges as the server: it is the user's own command, not sandboxed.
 *
 * Environment variables:
 *   PRISM_HOOK_TIMEOUT_MS - Maximum hook duration (default: 15 minutes)
 */

'use strict';

const fs        = require('fs');
const { spawn } = require('child_process');

const DEFAULT_HOOK_TIMEOUT_MS = 15 * 60 * 1000;
const KILL_GRACE_MS           = 5_000;
const OUTPUT_TAIL_BYTES       = 4_000;
const LOG_LIMIT_BYTES         = 5 * 1024 * 1024;
// A hook can leave a daemon holding its stdout open: 'close' would then never fire.
const EXIT_DRAIN_MS           = 2_000;

/**
 * @param {object} opts
 * @param {string} opts.command - Shell command.
 * @param {string} opts.cwd
 * @param {object} opts.env     - Added to the server's environment.
 * @param {string} opts.logPath - Receives the combined output, up to LOG_LIMIT_BYTES.
 * @returns {{ pid: number|undefined, done: Promise<{ exitCode: number|null, timedOut: boolean, outputTail: string }> }}
 */
function runCommandHook({ command, cwd, env, logPath }) {
  const timeoutMs = parseInt(process.env.PRISM_HOOK_TIMEOUT_MS || String(DEFAULT_HOOK_TIMEOUT_MS), 10);
  const detached  = process.platform !== 'win32';

  const child = spawn(command, {
    shell: true,
    detached,
    cwd,
    env:   { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const log = fs.createWriteStream(logPath);
  log.on('error', () => {}); // The log is a convenience. It must not fail the hook.
  let logged = 0;
  let tail   = Buffer.alloc(0);

  const onOutput = (chunk) => {
    if (logged < LOG_LIMIT_BYTES) {
      log.write(chunk);
      logged += chunk.length;
    }
    tail = Buffer.concat([tail, chunk]).subarray(-OUTPUT_TAIL_BYTES);
  };
  child.stdout.on('data', onOutput);
  child.stderr.on('data', onOutput);

  const signal = (name) => {
    try {
      if (detached) process.kill(-child.pid, name);
      else child.kill(name);
    } catch { /* already gone */ }
  };

  const done = new Promise((resolve) => {
    let timedOut = false;
    let settled  = false;
    let killTimer;
    let drainTimer;

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      signal('SIGTERM');
      killTimer = setTimeout(() => signal('SIGKILL'), KILL_GRACE_MS);
    }, timeoutMs);

    const settle = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      clearTimeout(drainTimer);
      log.end();
      resolve({ exitCode, timedOut, outputTail: tail.toString('utf8') });
    };

    child.on('error', (err) => {
      onOutput(Buffer.from(`${err.message}\n`));
      settle(null);
    });
    child.on('exit', (code) => {
      drainTimer = setTimeout(() => settle(code), EXIT_DRAIN_MS);
    });
    child.on('close', (code) => settle(code));
  });

  return { pid: child.pid, done };
}

module.exports = { runCommandHook };
