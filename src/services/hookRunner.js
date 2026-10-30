/**
 * Prism — Hook Runner
 *
 * Runs a space's hooks when an agent finishes a task: a command, or an agent that
 * reviews the work. They run in the task's worktree with the same privileges as the
 * server: they are the user's own, not sandboxed. Whatever a hook leaves running in
 * its process group ends with it, because Prism saves the worktree next. A hook that
 * starts a service must detach it with `setsid`.
 *
 * Environment variables:
 *   PRISM_HOOK_TIMEOUT_MS - Overrides each hook's own time limit
 */

'use strict';

const fs        = require('fs');
const { spawn } = require('child_process');

const DEFAULT_HOOK_TIMEOUT_MS = 30 * 60 * 1000;
const KILL_GRACE_MS           = 5_000;
const OUTPUT_TAIL_BYTES       = 4_000;
const LOG_LIMIT_BYTES         = 5 * 1024 * 1024;
const STDOUT_TAIL_BYTES       = 1024 * 1024;
// A hook can leave a daemon holding its stdout open: 'close' would then never fire.
const EXIT_DRAIN_MS           = 2_000;

/**
 * @param {object} opts
 * @param {string} opts.command      - What to spawn.
 * @param {string[]} [opts.args]     - Without them, command is a shell line.
 * @param {string|null} [opts.stdin]
 * @param {string} opts.cwd
 * @param {object} opts.env          - Added to the server's environment.
 * @param {string} opts.logPath      - Receives the combined output, up to LOG_LIMIT_BYTES.
 * @param {number} [opts.timeoutMs]
 * @returns {{ pid: number|undefined, done: Promise<{ exitCode: number|null, timedOut: boolean, outputTail: string, stdout: string }> }}
 */
function runHookProcess({ command, args, stdin, cwd, env, logPath, timeoutMs: ownTimeoutMs }) {
  const timeoutMs = parseInt(process.env.PRISM_HOOK_TIMEOUT_MS || String(ownTimeoutMs || DEFAULT_HOOK_TIMEOUT_MS), 10);
  const detached  = process.platform !== 'win32';

  const child = spawn(command, args ?? [], {
    shell: !args,
    detached,
    cwd,
    env:   { ...process.env, ...env },
    stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });

  if (stdin) {
    child.stdin.on('error', () => {}); // An agent that exits early closes its stdin.
    child.stdin.end(stdin);
  }

  const log = fs.createWriteStream(logPath);
  log.on('error', () => {}); // The log is a convenience. It must not fail the hook.
  let logged = 0;
  let tail   = Buffer.alloc(0);
  let stdout = Buffer.alloc(0);

  const onOutput = (chunk) => {
    if (logged < LOG_LIMIT_BYTES) {
      log.write(chunk);
      logged += chunk.length;
    }
    tail = Buffer.concat([tail, chunk]).subarray(-OUTPUT_TAIL_BYTES);
  };
  child.stdout.on('data', (chunk) => {
    onOutput(chunk);
    stdout = Buffer.concat([stdout, chunk]).subarray(-STDOUT_TAIL_BYTES);
  });
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
      signal('SIGKILL');
      child.stdout.destroy();
      child.stderr.destroy();
      log.end();
      resolve({ exitCode, timedOut, outputTail: tail.toString('utf8'), stdout: stdout.toString('utf8') });
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

module.exports = { runHookProcess };
