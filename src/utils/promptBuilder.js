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
 *   buildKanbanBlock(spaceId, taskId)      → ## KANBAN INSTRUCTIONS
 *   buildGitContextBlock(workingDirectory)  → ## GIT CONTEXT  (live git state)
 *   buildGitInstructionsBlock()             → ## GIT INSTRUCTIONS (static workflow)
 *   buildCompileGateBlock()                 → ## MANDATORY COMPILE GATE
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
 * Contains the tool list, the task reference, the blocker-question pattern,
 * and the note/handoff guidance lines.
 *
 * @param {string} spaceId
 * @param {string} taskId
 * @param {boolean} [isLastStage=true] - When false (intermediate pipeline
 *   stage), the agent is told NOT to move the task to done — a later stage
 *   closes it. Defaults to true for manual prompts and single-stage runs.
 * @returns {string}
 */
function buildKanbanBlock(spaceId, taskId, isLastStage = true) {
  const moveLine = isLastStage
    ? 'Move this task: todo → in-progress (immediately) → done (when finished).'
    : 'Move this task: todo → in-progress (immediately). Do NOT move it to done — a later pipeline stage closes the task.';
  return [
    '## KANBAN INSTRUCTIONS',
    'Space ID: ' + spaceId + '  |  Task ID: ' + taskId,
    moveLine,
    'Tools: kanban_move_task · kanban_update_task · kanban_add_comment · kanban_answer_comment',
    '',
    '⚠️ CRITICAL — DO NOT kill, restart, or spawn `node server.js`. The pipeline runs inside that process; touching it interrupts your own run. The server is already running — assume so without checking.',
    '',
    'STOP and post a question (do NOT assume) when ANY of these is true:',
    '  • A required artifact (spec, wireframe, ADR) is missing or unreadable',
    '  • You face ≥2 valid options and nothing in the brief lets you choose',
    '  • Resolving an ambiguity would require changing ≥2 files in a non-obvious way',
    '  • You need a dependency or pattern not mentioned in the design',
    '  • A decision is irreversible or cross-team and you have no explicit approval',
    '  mcp__prism__kanban_add_comment({ spaceId: "' + spaceId + '", taskId: "' + taskId + '", author: "<agent-id>", type: "question", text: "<question + both options>", targetAgent: "<agent-id or omit>" })',
    'The pipeline pauses automatically. Resume once answered via kanban_answer_comment.',
    '',
    'POST A NOTE (type: "note", does NOT pause pipeline) for any of these:',
    '  • Non-obvious assumption: something you assumed that is not explicit in the spec',
    '    mcp__prism__kanban_add_comment({ spaceId: "' + spaceId + '", taskId: "' + taskId + '", author: "<your-agent-id>", type: "note", text: "Assumption: <what + why>" })',
    '  • Blueprint deviation: you decided to do something differently than specified',
    '    mcp__prism__kanban_add_comment({ spaceId: "' + spaceId + '", taskId: "' + taskId + '", author: "<your-agent-id>", type: "note", text: "Deviation: <what changed + why>" })',
    '  • Non-trivial trade-off: you chose approach A over B and the reason is not obvious',
    '    mcp__prism__kanban_add_comment({ spaceId: "' + spaceId + '", taskId: "' + taskId + '", author: "<your-agent-id>", type: "note", text: "Trade-off: chose <A> over <B> because <reason>" })',
    '  • Hard-won lesson: you hit a non-obvious failure and solved it (these notes feed the Folio knowledge base)',
    '    mcp__prism__kanban_add_comment({ spaceId: "' + spaceId + '", taskId: "' + taskId + '", author: "<your-agent-id>", type: "note", text: "Lesson: <what failed> — root cause: <cause>. Fix: <fix>" })',
    '',
    'HANDOFF SUMMARY — post BEFORE moving to done (always, even if no deviations):',
    '  mcp__prism__kanban_add_comment({ spaceId: "' + spaceId + '", taskId: "' + taskId + '", author: "<your-agent-id>", type: "note", text: "Handoff: produced <artifacts>. Next agent should read <key files>. Folio pages used: <slugs, or none>." })',
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

    const parts = ['\n## GIT CONTEXT (recent commits + working tree state in ' + workingDirectory + ')'];
    if (gitLog)    parts.push('```\n' + gitLog + '\n```');
    if (gitStatus) parts.push('\nWorking tree changes:\n```\n' + gitStatus + '\n```');
    return parts.join('\n');
  } catch {
    return '';
  }
}

/**
 * Per-stage commit message formats. Keep in sync with the Git table in the
 * user-level CLAUDE.md (architect/ux/dev/review/qa/fix-loop formats).
 */
const COMMIT_FORMATS = {
  'senior-architect': '[architect] <feature>: ADR + blueprint + tasks',
  'ux-api-designer':  '[ux] <feature>: wireframes + api-spec + user-stories',
  'developer-agent':  '[dev] T-XXX: <task title>  (fix loop: [fix] BUG-XXX: <description>)',
  'code-reviewer':    '[review] <feature>: review-report',
  'qa-engineer-e2e':  '[qa] <feature>: test-plan + results + bugs',
};

/**
 * Build the ## GIT INSTRUCTIONS block with static workflow guidance.
 *
 * Used by manually-generated prompts (POST /api/v1/agent/prompt) to tell
 * agents how to handle branching and commits, rather than showing live state.
 *
 * @param {string} [agentId] - Stage agent id; selects the commit format line.
 * @returns {string}
 */
function buildGitInstructionsBlock(agentId) {
  const commitFormat = COMMIT_FORMATS[agentId] || '[dev] T-XXX: <task title>';
  return [
    '## GIT INSTRUCTIONS',
    '- Before any commit, ensure you are on a branch named `<prefix>/<kebab-task-title>` where prefix matches the task type: feature→feature, bug→fix, tech-debt→chore, research→research. If the current branch is `main` or unrelated to this task, create it: `git checkout -b <prefix>/<kebab-task-title>`',
    '- Commit format: ' + commitFormat,
    '- Stage only task-relevant files (never git add -A or git add .)',
    '- Never commit to main directly',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Resolved Q&A block
// ---------------------------------------------------------------------------

/**
 * Build the ## RESOLVED QUESTIONS block from a task's comment array.
 *
 * Included in the stage prompt when one or more question comments on the task
 * have been resolved. Each question is paired with its answer comment
 * (identified by parentId) so the next agent knows what was decided during
 * the pipeline's blocked phase.
 *
 * Returns an empty string when there are no resolved questions.
 *
 * @param {Array<object>} comments - The full comments array from the task.
 * @returns {string}
 */
function buildResolvedQuestionsBlock(comments) {
  if (!Array.isArray(comments) || comments.length === 0) return '';

  const resolvedQuestions = comments.filter((c) => c.type === 'question' && c.resolved);
  if (resolvedQuestions.length === 0) return '';

  const lines = [
    '## RESOLVED QUESTIONS',
    'The following questions were raised and answered during this pipeline run.',
    'Apply these decisions in your work — do not re-ask them.',
    '',
  ];

  for (const q of resolvedQuestions) {
    const answer = comments.find((c) => c.type === 'answer' && c.parentId === q.id);
    lines.push(`**Q (${q.author}):** ${q.text}`);
    if (answer) {
      lines.push(`**A (${answer.author}):** ${answer.text}`);
    } else {
      // Question was marked resolved without a separate answer comment
      // (e.g. resolved programmatically or via direct PATCH).
      lines.push('**A:** *(resolved — answer not recorded)*');
    }
    lines.push('');
  }

  return lines.join('\n');
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
  buildResolvedQuestionsBlock,
};
