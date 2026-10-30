/**
 * Prism — Pull Requests
 *
 * Pushes a run's branch and opens its pull request with the GitHub CLI, or finds the
 * one already open. Arguments never pass through a shell.
 */

'use strict';

const { execFile } = require('child_process');

const COMMAND_TIMEOUT_MS = 60_000;

function run(binary, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' },
    }, (err, stdout, stderr) => {
      if (err) {
        err.detail = (stderr || err.message).trim();
        return reject(err);
      }
      return resolve(stdout.trim());
    });
  });
}

function prError(message) {
  const err = new Error(message);
  err.code = 'PR_FAILED';
  return err;
}

async function findRemote(cwd) {
  const remotes = (await run('git', ['remote'], cwd)).split('\n').filter(Boolean);
  if (remotes.length === 0) throw prError('This repository has no remote to push to.');
  return remotes.includes('origin') ? 'origin' : remotes[0];
}

/**
 * The open pull request of a branch, if there is one.
 *
 * @returns {Promise<{ url: string, number: number }|null>}
 */
async function findOpenPullRequest(cwd, branch) {
  let output;
  try {
    output = await run('gh', ['pr', 'view', branch, '--json', 'url,number,state'], cwd);
  } catch (err) {
    if (err.code === 'ENOENT') throw err;
    return null; // gh reports "no pull requests found" as a failure.
  }
  const { url, number, state } = JSON.parse(output);
  return state === 'OPEN' ? { url, number } : null;
}

/**
 * @param {object} opts
 * @param {string} opts.cwd                - The repository.
 * @param {string} opts.branch
 * @param {string} [opts.sourceRef]        - Local branch to push to it, if not the same one.
 * @param {string|null} opts.baseBranch
 * @param {string} opts.title
 * @param {string} opts.body
 * @returns {Promise<{ url: string, number: number }>}
 * @throws PR_FAILED, with a message the user can act on.
 */
async function pushAndOpenPullRequest({ cwd, branch, sourceRef, baseBranch, title, body }) {
  try {
    const remote = await findRemote(cwd);
    await run('git', ['push', '-u', remote, `refs/heads/${sourceRef ?? branch}:refs/heads/${branch}`], cwd);

    const existing = await findOpenPullRequest(cwd, branch);
    if (existing) return existing;

    await run('gh', [
      'pr', 'create', '--head', branch, '--title', title, '--body', body,
      ...(baseBranch ? ['--base', baseBranch] : []),
    ], cwd);
    const created = await findOpenPullRequest(cwd, branch);
    if (!created) throw prError('The pull request was created but could not be found.');
    return created;
  } catch (err) {
    if (err.code === 'PR_FAILED') throw err;
    if (err.code === 'ENOENT') throw prError('The GitHub CLI (gh) is not installed on this machine.');
    throw prError(err.detail || err.message);
  }
}

module.exports = { pushAndOpenPullRequest };
