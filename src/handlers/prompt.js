'use strict';

/**
 * Agent prompt generation handlers — ADR-1 §3.1
 *
 * Writes prompt files to data/.prompts/ and returns the path + CLI command
 * for the user to copy and run.
 *
 * Routes:
 *   POST /api/v1/agent/prompt  → handleGeneratePrompt
 *
 * Also exports cleanupOldPromptFiles() — called at startup and on a 6-hour interval.
 */

const fs   = require('fs');
const path = require('path');

const { sendJSON, sendError, parseBody } = require('../utils/http');
const { COLUMNS }                        = require('../constants');
const { getAgentsDir, AGENT_ID_RE }      = require('./agents');
const { readSettings }                   = require('./settings');
const { buildCommentGuidanceLines }      = require('../utils/promptComments');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROMPT_TTL_MS   = 24 * 60 * 60 * 1000; // 24 hours
const AGENT_PROMPT_ROUTE = /^\/api\/v1\/agent\/prompt$/;

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

/**
 * Build the CLI command string based on current settings and prompt file path.
 */
function buildCliCommand(settings, promptPath, dangerouslySkipPermissions = false) {
  const { tool, binary, fileInputMethod } = settings.cli;
  const bin = binary || tool;

  let promptRef;
  if (fileInputMethod === 'stdin-redirect') {
    promptRef = `< "${promptPath}"`;
  } else if (fileInputMethod === 'flag-file') {
    promptRef = `--file "${promptPath}"`;
  } else {
    // cat-subshell (default)
    promptRef = `"$(cat ${promptPath})"`;
  }

  if (tool === 'opencode') {
    return `${bin} run ${promptRef}`;
  }

  // claude (default) — interactive mode so tool calls and thinking are visible in the TUI.
  const extraFlags = dangerouslySkipPermissions ? ' --dangerously-skip-permissions' : '';
  return `${bin} ${promptRef}${extraFlags}`;
}

/**
 * Build the full prompt text from task data, agent content, and instruction blocks.
 * Assembles: TASK CONTEXT, AGENT INSTRUCTIONS, KANBAN INSTRUCTIONS, GIT INSTRUCTIONS, PROJECT CONTEXT.
 */
function buildPromptText(options) {
  const { task, taskColumn, space, agentContent, settings, customInstructions, workingDirectory } = options;

  const lines = [];

  // ── TASK CONTEXT ──────────────────────────────────────────────────────────
  lines.push('## TASK CONTEXT');
  lines.push(`Title: ${task.title}`);
  if (task.type)        lines.push(`Type: ${task.type}`);
  lines.push(`Column: ${taskColumn}`);
  lines.push(`Space: ${space.name}`);
  lines.push(`Space ID: ${space.id}`);
  if (task.assigned)    lines.push(`Assigned: ${task.assigned}`);
  if (task.description) lines.push(`\nDescription:\n${task.description}`);
  if (task.attachments && task.attachments.length > 0) {
    lines.push(`\nAttachments (${task.attachments.length}):`);
    for (const att of task.attachments) {
      lines.push(`  - ${att.name} (${att.type})`);
    }
  }

  // ── PERSONA (ADR-1 agent-personalities T-005) ─────────────────────────────
  // Injected BEFORE agent instructions so the agent reads its "self" context first.
  const { agentId } = options;
  if (agentId) {
    try {
      const { get: getPersonality } = require('../services/personalityStore');
      const personality = getPersonality(agentId);
      if (personality && personality.persona && personality.persona.trim().length > 0) {
        lines.push(`\n## PERSONA\n${personality.persona.trim()}`);
      }
    } catch {
      // personalityStore failure must never break prompt generation
    }
  }

  // ── AGENT INSTRUCTIONS ────────────────────────────────────────────────────
  lines.push('\n## AGENT INSTRUCTIONS');
  lines.push(agentContent);

  // ── KANBAN INSTRUCTIONS ───────────────────────────────────────────────────
  if (settings.prompts.includeKanbanBlock) {
    lines.push('\n## KANBAN INSTRUCTIONS');
    lines.push(`Prism Kanban server is running at http://localhost:3000`);
    lines.push(`Space ID: ${space.id}`);
    lines.push(`Task ID: ${task.id}  ← this task already exists. Do NOT create a new kanban task.`);
    lines.push(`Move THIS task through the board: todo → in-progress (immediately) → done (when finished).`);
    lines.push('Use the MCP tools (mcp__prism__kanban_*) to manage the board:');
    lines.push('  - kanban_list_spaces: list all spaces');
    lines.push('  - kanban_list_tasks: list tasks in a column');
    lines.push('  - kanban_get_task: get a single task by ID');
    lines.push('  - kanban_move_task: move a task between columns (todo → in-progress → done)');
    lines.push('  - kanban_update_task: update task fields or attach artifacts');
    lines.push('  - kanban_create_task: create new tasks (only if genuinely needed for a sub-task)');
    lines.push('  - kanban_add_comment: post a note or question on the task');
    lines.push('  - kanban_answer_comment: answer an existing question comment');
    lines.push('  - kanban_get_run_status: check pipeline run status');
    lines.push('');
    lines.push('STOP and post a question (do NOT assume) when ANY of these is true:');
    lines.push('  • A required artifact (spec, wireframe, ADR) is missing or unreadable and you cannot proceed without it');
    lines.push('  • You face ≥2 valid options and nothing in the brief lets you choose — name both options in the question');
    lines.push('  • Resolving an ambiguity would require changing ≥2 files in a non-obvious way');
    lines.push('  • You need a dependency or pattern not mentioned in the design');
    lines.push('  • A decision is irreversible or cross-team and you have no explicit approval');
    lines.push('');
    lines.push('How to post a question:');
    lines.push(`  mcp__prism__kanban_add_comment({ spaceId: "${space.id}", taskId: "${task.id}", author: "<your-agent-id>", type: "question", text: "<question — include the two options you are choosing between>", targetAgent: "<agent-id if another pipeline agent can answer, omit for human>" })`);
    lines.push('The pipeline pauses automatically. Resume once the question is answered via kanban_answer_comment.');
    lines.push('');
    lines.push(...buildCommentGuidanceLines(space.id, task.id));
  }

  // ── GIT INSTRUCTIONS ──────────────────────────────────────────────────────
  if (settings.prompts.includeGitBlock) {
    lines.push('\n## GIT INSTRUCTIONS');
    lines.push('- Work on the current feature branch (do not create new branches unless specified)');
    lines.push('- Commit format: [dev] T-XXX: <task title>');
    lines.push('- Stage only task-relevant files (never git add -A or git add .)');
    lines.push('- Never commit to main directly');
  }

  // ── PROJECT CONTEXT ───────────────────────────────────────────────────────
  const cwd = workingDirectory || space.workingDirectory || settings.prompts.workingDirectory || '';
  lines.push('\n## PROJECT CONTEXT');
  if (cwd) lines.push(`Working directory: ${cwd}`);
  lines.push(`Feature: ${space.name}`);

  // ── CUSTOM INSTRUCTIONS ───────────────────────────────────────────────────
  if (customInstructions && customInstructions.trim().length > 0) {
    lines.push('\n## ADDITIONAL INSTRUCTIONS');
    lines.push(customInstructions.trim());
  }

  return lines.join('\n');
}

/**
 * Find a task by ID across all columns for a given space.
 * Returns { task, column } or null if not found.
 *
 * @param {string} spaceId
 * @param {string} taskId
 * @param {string} dataDir
 * @returns {{ task: object, column: string } | null}
 */
function findTaskInSpace(spaceId, taskId, dataDir) {
  const spaceDir = path.join(dataDir, 'spaces', spaceId);
  for (const column of COLUMNS) {
    const filePath = path.join(spaceDir, `${column}.json`);
    if (!fs.existsSync(filePath)) continue;
    try {
      const tasks = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const task  = Array.isArray(tasks) ? tasks.find((t) => t.id === taskId) : null;
      if (task) return { task, column };
    } catch { /* skip corrupt files */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/agent/prompt
 * Assemble full prompt, write to data/.prompts/, return path + CLI command.
 */
async function handleGeneratePrompt(req, res, dataDir, spaceManager) {
  let body;
  try {
    body = await parseBody(req);
  } catch {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  if (!body || typeof body !== 'object') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object.');
  }

  for (const field of ['agentId', 'taskId', 'spaceId']) {
    if (!body[field] || typeof body[field] !== 'string') {
      return sendError(res, 400, 'VALIDATION_ERROR', `The '${field}' field is required.`, {
        suggestion: field === 'agentId'
          ? "Provide the kebab-case agent ID (e.g. 'senior-architect')."
          : `Provide a valid ${field}.`,
        field,
      });
    }
  }

  const { agentId, taskId, spaceId, customInstructions, workingDirectory, dangerouslySkipPermissions } = body;

  if (!AGENT_ID_RE.test(agentId)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'The agent ID provided is not valid.', {
      suggestion: "Agent IDs must be lowercase kebab-case (e.g. 'senior-architect').",
      field: 'agentId',
    });
  }

  const spaceResult = spaceManager.getSpace(spaceId);
  if (!spaceResult.ok) {
    return sendError(res, 404, 'TASK_NOT_FOUND', `Space '${spaceId}' not found.`);
  }

  const agentFilename = `${agentId}.md`;
  const agentPath     = path.join(getAgentsDir(), agentFilename);
  if (!fs.existsSync(agentPath)) {
    return sendError(res, 404, 'AGENT_NOT_FOUND', `No agent named '${agentId}' was found.`, {
      suggestion: `Check that '${agentFilename}' exists in ~/.claude/agents/.`,
    });
  }
  const agentContent = fs.readFileSync(agentPath, 'utf8');

  const taskResult = findTaskInSpace(spaceId, taskId, dataDir);
  if (!taskResult) {
    return sendError(res, 404, 'TASK_NOT_FOUND', `Task '${taskId}' was not found in space '${spaceId}'.`, {
      suggestion: 'Confirm the taskId and spaceId are correct. The task may have been moved or deleted.',
    });
  }

  const settings   = readSettings(dataDir);
  const promptsDir = path.join(dataDir, '.prompts');

  const rawPromptText = buildPromptText({
    task:             taskResult.task,
    taskColumn:       taskResult.column,
    space:            spaceResult.space,
    agentContent,
    agentId,
    settings,
    customInstructions,
    workingDirectory: workingDirectory || settings.prompts.workingDirectory,
  });

  const promptText = rawPromptText;

  if (!fs.existsSync(promptsDir)) {
    fs.mkdirSync(promptsDir, { recursive: true });
  }

  const timestamp  = Date.now();
  const taskPrefix = taskId.slice(0, 8);
  const filename   = `prompt-${timestamp}-${taskPrefix}.md`;
  const promptPath = path.join(promptsDir, filename);
  const tmpPath    = promptPath + '.tmp';

  try {
    fs.writeFileSync(tmpPath, promptText, 'utf8');
    fs.renameSync(tmpPath, promptPath);
  } catch (err) {
    console.error('[prompt] ERROR writing prompt file:', err.message);
    return sendError(res, 500, 'PROMPT_WRITE_ERROR', 'Could not write the prompt file to disk.', {
      suggestion: 'Check that data/.prompts/ is writable and the disk has available space.',
    });
  }

  const cliCommand      = buildCliCommand(settings, promptPath, dangerouslySkipPermissions === true);
  const promptPreview   = promptText.slice(0, 500);
  const estimatedTokens = Math.ceil(promptText.length / 4);
  const promptSizeBytes = Buffer.byteLength(promptText, 'utf8');

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    component: 'agent-launcher',
    event: 'agent_prompt_generated',
    agentId,
    taskId,
    spaceId,
    promptPath,
    estimatedTokens,
    promptSizeBytes,
  }));

  sendJSON(res, 201, {
    promptPath,
    promptPreview,
    promptFull:    promptText,
    cliCommand,
    estimatedTokens,
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Delete prompt files in data/.prompts/ that are older than PROMPT_TTL_MS.
 * Best-effort: individual file errors are logged but do not abort cleanup.
 *
 * @param {string} dataDir - Root data directory for this server instance.
 */
function cleanupOldPromptFiles(dataDir) {
  const promptsDir = path.join(dataDir, '.prompts');
  if (!fs.existsSync(promptsDir)) return;

  let entries;
  try {
    entries = fs.readdirSync(promptsDir);
  } catch (err) {
    console.warn('[cleanup] Could not read prompts dir:', err.message);
    return;
  }

  const cutoff = Date.now() - PROMPT_TTL_MS;
  let removed  = 0;

  for (const filename of entries) {
    if (!filename.endsWith('.md')) continue;
    const filePath = path.join(promptsDir, filename);
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        removed++;
      }
    } catch (err) {
      console.warn(`[cleanup] Could not process ${filename}:`, err.message);
    }
  }

  if (removed > 0) {
    console.log(`[cleanup] Removed ${removed} old prompt file(s)`);
  }
}

module.exports = {
  AGENT_PROMPT_ROUTE,
  buildCliCommand,
  buildPromptText,
  findTaskInSpace,
  handleGeneratePrompt,
  cleanupOldPromptFiles,
};
