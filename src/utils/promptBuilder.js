'use strict';

/**
 * Shared prompt-block builders.
 *
 * Both buildStagePrompt (pipelineManager.js) and buildPromptText (prompt.js)
 * previously duplicated the KANBAN INSTRUCTIONS, GIT, and COMPILE GATE blocks.
 * Any change had to be applied in two places. This module is the single source
 * of truth — update here and both code paths reflect it automatically.
 *
 * Exported functions:
 *   buildKanbanBlock(spaceId, taskId)     → ## KANBAN INSTRUCTIONS
 *   buildGitContextBlock(workingDirectory) → ## GIT CONTEXT  (live git state)
 *   buildGitInstructionsBlock()            → ## GIT INSTRUCTIONS (static workflow)
 *   buildCompileGateBlock()                → ## MANDATORY COMPILE GATE
 */

const fs           = require('fs');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// KANBAN block
// ---------------------------------------------------------------------------

/**
 * Build the ## KANBAN INSTRUCTIONS block.
 *
 * Used by both pipeline-launched agents and manually-generated prompts.
 * Contains the tool list, the task reference, and the blocker-question pattern.
 *
 * @param {string} spaceId
 * @param {string} taskId
 * @returns {string}
 */
function buildKanbanBlock(spaceId, taskId) {
  return [
    '## KANBAN INSTRUCTIONS',
    'Prism Kanban server is running at http://localhost:3000',
    `Space ID: ${spaceId}`,
    `Task ID: ${taskId}  ← this task already exists. Do NOT create a new kanban task.`,
    'Move THIS task through the board: todo → in-progress (immediately) → done (when finished).',
    'Use the MCP tools (mcp__prism__kanban_*) to manage the board:',
    '  - kanban_list_spaces: list all spaces',
    '  - kanban_list_tasks: list tasks in a column',
    '  - kanban_get_task: get a single task by ID',
    '  - kanban_move_task: move a task between columns (todo → in-progress → done)',
    '  - kanban_update_task: update task fields or attach artifacts',
    '  - kanban_create_task: create new tasks (only if genuinely needed for a sub-task)',
    '  - kanban_add_comment: post a note or question on the task',
    '  - kanban_answer_comment: answer an existing question comment',
    '  - kanban_get_run_status: check pipeline run status',
    '',
    'STOP and post a question (do NOT assume) when ANY of these is true:',
    '  • A required artifact (spec, wireframe, ADR) is missing or unreadable and you cannot proceed without it',
    '  • You face ≥2 valid options and nothing in the brief lets you choose — name both options in the question',
    '  • Resolving an ambiguity would require changing ≥2 files in a non-obvious way',
    '  • You need a dependency or pattern not mentioned in the design',
    '  • A decision is irreversible or cross-team and you have no explicit approval',
    '',
    'How to post a question:',
    `  mcp__prism__kanban_add_comment({ spaceId: "${spaceId}", taskId: "${taskId}", author: "<your-agent-id>", type: "question", text: "<question — include the two options you are choosing between>", targetAgent: "<agent-id if another pipeline agent can answer, omit for human>" })`,
    'The pipeline pauses automatically. Resume once the question is answered via kanban_answer_comment.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// GIT blocks
// ---------------------------------------------------------------------------

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
    // Exclude untracked files (??) — they are irrelevant to pipeline agents
    // and can be misleading when a project has many generated / build artefacts.
    const gitStatus = rawStatus.split('\n').filter(l => l && !l.startsWith('??')).join('\n').trim();
    if (!gitLog && !gitStatus) return '';

    const parts = [`\n## GIT CONTEXT (recent commits + working tree state in ${workingDirectory})`];
    if (gitLog)    parts.push('```\n' + gitLog + '\n```');
    if (gitStatus) parts.push('\nWorking tree changes:\n```\n' + gitStatus + '\n```');
    return parts.join('\n');
  } catch {
    return '';
  }
}

/**
 * Build the ## GIT INSTRUCTIONS block with static workflow guidance.
 *
 * Used by manually-generated prompts (POST /api/v1/agent/prompt) to tell
 * agents how to handle branching and commits, rather than showing live state.
 *
 * @returns {string}
 */
function buildGitInstructionsBlock() {
  return [
    '## GIT INSTRUCTIONS',
    '- Work on the current feature branch (do not create new branches unless specified)',
    '- Commit format: [dev] T-XXX: <task title>',
    '- Stage only task-relevant files (never git add -A or git add .)',
    '- Never commit to main directly',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Compile gate
// ---------------------------------------------------------------------------

/**
 * Build the ## MANDATORY COMPILE GATE block.
 *
 * Only include for developer-agent stages; callers are responsible for the
 * `agentId === 'developer-agent'` guard.
 *
 * @returns {string}
 */
function buildCompileGateBlock() {
  return [
    '## MANDATORY COMPILE GATE',
    'Before marking your Kanban task done, you MUST verify the code compiles:',
    '- Java/Maven: run `mvn compile -q` (or `./mvnw compile -q`)',
    '- Java/Gradle: run `./gradlew compileJava -q`',
    '- TypeScript/Node: run `npm run build` or `tsc --noEmit`',
    'If compilation fails, fix the errors before closing the task. Do NOT advance to QA with broken code.',
  ].join('\n');
}

module.exports = {
  buildKanbanBlock,
  buildGitContextBlock,
  buildGitInstructionsBlock,
  buildCompileGateBlock,
};
