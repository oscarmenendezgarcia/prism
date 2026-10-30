'use strict';

/**
 * Blocks of the prompt an agent gets for a task.
 */

const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Build the block that teaches an agent running a task directly how to use its card.
 * The REST form is there for harnesses that do not have Prism's MCP tools.
 *
 * @param {string} spaceId
 * @param {string} taskId
 * @param {string} agentId
 * @returns {string}
 */
function buildDirectCardBlock(spaceId, taskId, agentId) {
  const commentsUrl = `$KANBAN_API_URL/spaces/${spaceId}/tasks/${taskId}/comments`;
  return [
    '## YOUR CARD IN PRISM',
    'Space ID: ' + spaceId + '  |  Task ID: ' + taskId,
    'Prism runs this task. It commits anything you leave uncommitted, runs the check the user configured, and closes the card. Do NOT move this card, and do NOT start, stop or restart Prism.',
    '',
    'Leave a note on the card when you finish, or to record a decision the user should know about:',
    `  mcp__prism__kanban_add_comment({ spaceId, taskId, author: "${agentId}", type: "note", text: "..." })`,
    '',
    'Ask instead of guessing when the task is ambiguous, you face valid options it does not decide between, or a decision is hard to undo:',
    `  mcp__prism__kanban_add_comment({ spaceId, taskId, author: "${agentId}", type: "question", text: "<question and the options>" })`,
    'Then stop working. Prism relaunches you in this same directory with the answer.',
    '',
    'To create a follow-up card: mcp__prism__kanban_create_task. To read this card: mcp__prism__kanban_get_task.',
    '',
    'If you do not have those tools, use the REST API. The same comment with curl:',
    `  curl -s -X POST "${commentsUrl}" -H "Authorization: Bearer $PRISM_TOKEN" -H "Content-Type: application/json" -d '{"author":"${agentId}","type":"note","text":"..."}'`,
  ].join('\n');
}

const MAX_PROMPT_COMMENTS     = 30;
const MAX_PROMPT_COMMENT_CHARS = 2000;

/**
 * Build the block with the card's conversation, so a relaunched agent knows what
 * was said. Returns an empty string when there are no comments.
 *
 * @param {Array<{ author: string, type: string, text: string }>} comments
 * @returns {string}
 */
function buildCommentsBlock(comments) {
  const recent = (comments || []).slice(-MAX_PROMPT_COMMENTS);
  if (recent.length === 0) return '';
  const lines = recent.map((c) => {
    const text = c.text.length > MAX_PROMPT_COMMENT_CHARS
      ? `${c.text.slice(0, MAX_PROMPT_COMMENT_CHARS)}… [truncated]`
      : c.text;
    return `- ${c.author} (${c.type}): ${text}`;
  });
  return ['## COMMENTS ON THIS CARD', 'Oldest first.', ...lines].join('\n');
}

/**
 * Build the block for an agent relaunched because the user asked for changes.
 *
 * @param {string} text         - What the user asked for.
 * @param {string|null} baseRef - Commit the run branch started from.
 * @returns {string}
 */
function buildChangeRequestBlock(text, baseRef) {
  return [
    '## CHANGES REQUESTED',
    'You already worked on this task. Your earlier work is committed on the current branch' +
      (baseRef ? ` (see it with \`git diff ${baseRef}\`).` : '.') +
      ' The user reviewed it and asks for this:',
    '',
    text,
    '',
    'Change only what this asks for, and keep the rest of the earlier work.',
  ].join('\n');
}

/**
 * Build the ## GIT CONTEXT block from live git state in workingDirectory.
 *
 * Only included when workingDirectory is explicitly set and exists on disk.
 * Falling back to process.cwd() would expose Prism's own git history to agents
 * that have no project directory — which is misleading and incorrect.
 *
 * @param {string} [workingDirectory]
 * @returns {string} Empty string when no workingDirectory or git unavailable.
 */
function buildGitContextBlock(workingDirectory) {
  if (!workingDirectory || !fs.existsSync(workingDirectory)) return '';

  try {
    const opts      = { encoding: 'utf8', timeout: 5000, cwd: workingDirectory };
    const gitLog    = execSync('git log --oneline -10 2>/dev/null', opts).trim();
    const rawStatus = execSync('git status --short 2>/dev/null', opts).trim();
    // Exclude untracked files (??) — they are irrelevant to agents
    // and can be misleading when a project has many generated / build artefacts.
    const gitStatus = rawStatus.split('\n').filter(l => l && !l.startsWith('??')).join('\n').trim();
    if (!gitLog && !gitStatus) return '';

    const parts = ['\n## GIT CONTEXT (recent commits + working tree state in ' + workingDirectory + ')'];
    if (gitLog)    parts.push('```\n' + gitLog + '\n```');
    if (gitStatus) parts.push('\nWorking tree changes:\n```\n' + gitStatus + '\n```');
    return parts.join('\n');
  } catch {
    return '';
  }
}

module.exports = {
  buildDirectCardBlock,
  buildCommentsBlock,
  buildChangeRequestBlock,
  buildGitContextBlock,
};
