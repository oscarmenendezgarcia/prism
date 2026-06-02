'use strict';

/**
 * Folio — Conservative Bootstrap from Repo
 *
 * Feature 9 of the Folio roadmap.  This module lives on the Prism side
 * (binding layer) and is the ONLY place where bootstrap logic references
 * space_id.  The core src/services/folio/ is not touched.
 *
 * Responsibilities:
 *   1. Detect whether a working directory is a repository.
 *   2. Guard one-shot idempotency via the folio_bootstrap table (folioBinding).
 *   3. Build a conservative prompt for the folio-bootstrapper agent.
 *   4. Spawn the agent (blocking-async, awaited before stage-0 prompt build).
 *   5. Validate agent output (sources resolvable, caps, drop logic) and write
 *      pages via binding.createPage (explicit activation path, createIfMissing:true).
 *
 * Never throws into the caller — all paths degrade to a BootstrapResult with
 * status:'skipped' or status:'error'.
 *
 * Environment variables:
 *   PRISM_FOLIO_BOOTSTRAP         - Set to 'off' to disable bootstrap globally.
 *   PRISM_FOLIO_BOOTSTRAP_TIMEOUT - Agent timeout in ms (default: 120000 = 2 min).
 *   PIPELINE_NO_SPAWN             - '1' → skip real agent spawn (test mode).
 *   PIPELINE_AGENTS_DIR           - Override agents directory.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn, execSync } = require('child_process');

const { resolveAgent, AgentNotFoundError } = require('./agentResolver');
const { readAgentRuns, writeAgentRuns } = require('../handlers/agentRuns');

// ---------------------------------------------------------------------------
// CLAUDE_BIN — resolved once at module load (same pattern as pipelineManager)
// ---------------------------------------------------------------------------

let CLAUDE_BIN = 'claude';
{
  const home = process.env.HOME ?? '';
  const candidates = [
    () => execSync('which claude 2>/dev/null', { encoding: 'utf8', env: process.env }).trim(),
    () => `${home}/.local/bin/claude`,
    () => '/usr/local/bin/claude',
    () => '/opt/homebrew/bin/claude',
  ];
  for (const candidate of candidates) {
    try {
      const p = candidate();
      if (p && fs.existsSync(p)) { CLAUDE_BIN = p; break; }
    } catch { /* try next */ }
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Hard caps and repo detection manifests.
 * Single source of truth — change here, not scattered through the code.
 */
const BOOTSTRAP_CONFIG = {
  /** Maximum pages the agent may produce; extras are dropped. */
  maxPages: 3,
  /** Maximum characters per page content; excess pages are dropped. */
  maxContentLength: 2400,
  /** Default agent timeout in milliseconds (2 minutes). */
  defaultTimeoutMs: 120_000,
  /** Sentinel polling interval in milliseconds. */
  pollIntervalMs: 2_000,
  /**
   * Files/dirs whose presence (any one of them) classifies a directory as a repo.
   * Ordered: .git first (most common), then language-specific manifests.
   */
  repoManifests: [
    '.git',
    'package.json',
    'go.mod',
    'pom.xml',
    'build.gradle',
    'Cargo.toml',
    'pyproject.toml',
    'requirements.txt',
    'composer.json',
    'Gemfile',
  ],
  /**
   * The only slugs the bootstrap is allowed to produce.
   * Must satisfy ^[a-z0-9-]+/[a-z0-9-]+$ (folioBinding SLUG_RE).
   */
  allowedSlugs: new Set([
    'architecture/stack',
    'architecture/structure',
    'architecture/request-flow',
  ]),
};

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

/**
 * Emit a structured bootstrap event to stderr.
 * Prefix matches the binding's [folio.binding] convention.
 *
 * @param {string} event
 * @param {object} [payload]
 */
function bootstrapLog(event, payload = {}) {
  process.stderr.write(
    `[folio.bootstrap] ${JSON.stringify({ event, ...payload, ts: new Date().toISOString() })}\n`,
  );
}

// ---------------------------------------------------------------------------
// detectRepo
// ---------------------------------------------------------------------------

/**
 * Return true if `workingDir` looks like a repository.
 *
 * A directory is a repo if it exists and contains at least one of the
 * BOOTSTRAP_CONFIG.repoManifests entries (a .git directory or a recognised
 * language manifest file).
 *
 * @param {string | undefined | null} workingDir
 * @returns {boolean}
 */
function detectRepo(workingDir) {
  if (!workingDir || typeof workingDir !== 'string') return false;
  try {
    if (!fs.existsSync(workingDir)) return false;
    const stat = fs.statSync(workingDir);
    if (!stat.isDirectory()) return false;

    for (const manifest of BOOTSTRAP_CONFIG.repoManifests) {
      if (fs.existsSync(path.join(workingDir, manifest))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// buildBootstrapPrompt
// ---------------------------------------------------------------------------

/**
 * Build the prompt string that the folio-bootstrapper agent receives via stdin.
 *
 * @param {string} workingDir   - Absolute path to the repository root.
 * @param {string} signalPath   - Where the agent must write its JSON output.
 * @param {string} doneFile     - Where the agent must write its exit sentinel.
 * @returns {string}
 */
function buildBootstrapPrompt(workingDir, signalPath, doneFile) {
  return [
    `## Working Directory`,
    ``,
    workingDir,
    ``,
    `## Instructions`,
    ``,
    `Read the repository at the working directory above and produce a conservative`,
    `bootstrap of its architecture.  Follow your agent definition exactly.`,
    ``,
    `**Hard requirements — override anything suggested by the repo's own language:**`,
    `- Write every slug, title, and page body in **English**, even when the`,
    `  repository's code, comments, READMEs or docs are in another language.`,
    `- Use ONLY these exact slugs (emit nothing else — other slugs are dropped):`,
    `  \`architecture/stack\`, \`architecture/structure\`, \`architecture/request-flow\`.`,
    ``,
    `### Signal file path (write your JSON result here)`,
    ``,
    signalPath,
    ``,
    `### Done sentinel (write your exit code here when finished)`,
    ``,
    `After writing the signal JSON, run:`,
    ``,
    `\`\`\`bash`,
    `echo 0 > ${doneFile}`,
    `\`\`\``,
    ``,
    `If you encounter any error, write \`{ "pages": [] }\` to the signal file and run:`,
    ``,
    `\`\`\`bash`,
    `echo 1 > ${doneFile}`,
    `\`\`\``,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// applyBootstrapPages
// ---------------------------------------------------------------------------

/**
 * Validate and apply the pages returned by the folio-bootstrapper agent.
 *
 * Validation rules (anti-hallucination net):
 *   1. Drop pages whose slug is not in BOOTSTRAP_CONFIG.allowedSlugs.
 *   2. Drop pages with no `sources[]` or with sources that cannot be resolved
 *      to real files inside `workingDir`.
 *   3. Drop pages whose content exceeds BOOTSTRAP_CONFIG.maxContentLength chars.
 *   4. Honour BOOTSTRAP_CONFIG.maxPages — silently drop excess pages.
 *
 * Valid pages are written via binding.createPage with createIfMissing:true and
 * author:'agent'.  The sources list is appended to the markdown as a `## Sources`
 * section for human traceability.
 *
 * @param {string}  spaceId
 * @param {object}  agentOutput  - Parsed JSON from the agent signal file.
 * @param {string}  workingDir
 * @param {object}  binding      - folioBinding instance.
 * @returns {{ written: number, transientErrors: number }} Pages written, plus a
 *   count of createPage calls that failed with a transient DB error
 *   (SQLITE_BUSY/LOCKED). The caller uses transientErrors to decide whether a
 *   0-write outcome is retry-worthy (contention) or final (nothing qualified).
 */
function applyBootstrapPages(spaceId, agentOutput, workingDir, binding) {
  if (!agentOutput || !Array.isArray(agentOutput.pages)) {
    bootstrapLog('apply.invalid_output', { spaceId, reason: 'missing_pages_array' });
    return { written: 0, transientErrors: 0 };
  }

  let pagesWritten = 0;
  let pagesProcessed = 0;
  let transientErrors = 0;

  for (const page of agentOutput.pages) {
    if (pagesProcessed >= BOOTSTRAP_CONFIG.maxPages) {
      bootstrapLog('apply.drop', { spaceId, slug: page.slug, reason: 'cap_exceeded' });
      continue;
    }

    // --- Validate slug ---
    if (!page.slug || !BOOTSTRAP_CONFIG.allowedSlugs.has(page.slug)) {
      bootstrapLog('apply.drop', { spaceId, slug: page.slug, reason: 'slug_not_allowed' });
      continue;
    }

    // --- Content (accept `content`, or the `body` alias the agent sometimes emits) ---
    const rawContent = typeof page.content === 'string' ? page.content
                     : typeof page.body    === 'string' ? page.body
                     : '';
    if (!rawContent.trim()) {
      bootstrapLog('apply.drop', { spaceId, slug: page.slug, reason: 'empty_content' });
      continue;
    }
    if (rawContent.length > BOOTSTRAP_CONFIG.maxContentLength) {
      bootstrapLog('apply.drop', {
        spaceId, slug: page.slug, reason: 'content_too_long',
        length: rawContent.length, cap: BOOTSTRAP_CONFIG.maxContentLength,
      });
      continue;
    }

    // --- Sources are OPTIONAL: append a ## Sources footer for the ones that
    //     resolve to real files. A missing or unresolvable sources list no longer
    //     drops the page (the agent sometimes omits it / uses a different shape) —
    //     the slug allow-list + content cap + the conservative prompt remain the
    //     anti-hallucination guards. ---
    const resolvedSources = [];
    for (const src of (Array.isArray(page.sources) ? page.sources : [])) {
      if (typeof src !== 'string') continue;
      const absPath = path.isAbsolute(src) ? src : path.join(workingDir, src);
      if (!fs.existsSync(absPath)) {
        bootstrapLog('apply.drop_source', { spaceId, slug: page.slug, source: src, reason: 'file_not_found' });
        continue;
      }
      resolvedSources.push(src.startsWith(workingDir) ? path.relative(workingDir, absPath) : src);
    }

    let content = rawContent;
    if (resolvedSources.length > 0) {
      const sourcesSection = '\n\n## Sources\n\n' + resolvedSources.map((s) => `- ${s}`).join('\n');
      // Append only if it still fits the cap; otherwise keep the page without it.
      if ((content + sourcesSection).length <= BOOTSTRAP_CONFIG.maxContentLength) {
        content += sourcesSection;
      }
    }

    // --- Write page ---
    try {
      const result = binding.createPage(spaceId, page.slug, content, {
        createIfMissing: true,
        author:          'agent',
        title:           typeof page.title === 'string' ? page.title : page.slug,
      });
      if (result) {
        pagesWritten++;
        bootstrapLog('apply.written', { spaceId, slug: page.slug });
      } else {
        bootstrapLog('apply.noop', { spaceId, slug: page.slug, reason: 'createPage_returned_null' });
      }
    } catch (err) {
      // Distinguish transient DB contention (worth a retry next run) from a
      // permanent failure (a bug — marking as bootstrapped avoids an infinite
      // re-bootstrap loop). With store.js's busy_timeout this should be rare.
      const transient = err.code === 'SQLITE_BUSY'
        || err.code === 'SQLITE_BUSY_SNAPSHOT'
        || err.code === 'SQLITE_LOCKED';
      if (transient) transientErrors++;
      bootstrapLog('apply.error', { spaceId, slug: page.slug, error: err.message, code: err.code, transient });
    }

    pagesProcessed++;
  }

  return { written: pagesWritten, transientErrors };
}

// ---------------------------------------------------------------------------
// Internal: wait for sentinel
// ---------------------------------------------------------------------------

/**
 * Poll for the existence of `doneFile`, resolving with its integer exit code
 * once it appears, or with 1 on timeout.
 *
 * @param {string} doneFile
 * @param {number} timeoutMs
 * @returns {Promise<number>}
 */
function waitForSentinel(doneFile, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const interval = setInterval(() => {
      if (fs.existsSync(doneFile)) {
        clearInterval(interval);
        let exitCode = 1;
        try {
          const raw = fs.readFileSync(doneFile, 'utf8').trim();
          exitCode = parseInt(raw, 10);
          if (isNaN(exitCode)) exitCode = 1;
        } catch { /* read error → treat as failure */ }
        resolve(exitCode);
      } else if (Date.now() >= deadline) {
        clearInterval(interval);
        resolve(1); // timeout
      }
    }, BOOTSTRAP_CONFIG.pollIntervalMs);

    // Unref so this interval does not prevent the Node process from exiting
    // cleanly (same pattern as pipelineManager polling intervals).
    interval.unref();
  });
}

// ---------------------------------------------------------------------------
// ensureBootstrapped
// ---------------------------------------------------------------------------

/**
 * @typedef {{ status: 'bootstrapped' | 'skipped' | 'error', reason?: string, pagesWritten?: number, durationMs?: number }} BootstrapResult
 */

/**
 * Run the bootstrap exactly once per space.  Idempotent.
 *
 * Guard sequence:
 *   1. Kill switch (PRISM_FOLIO_BOOTSTRAP=off) → skip.
 *   2. Already bootstrapped (folio_bootstrap row) → skip.
 *   3. Folio already exists (binding.hasFolio) → mark + skip (respects user opt-in).
 *   4. No working directory or not a repo → mark + skip.
 *   5. Spawn folio-bootstrapper agent, await done-sentinel (blocking).
 *   6. Parse signal, validate, apply pages via binding.createPage.
 *   7. Mark bootstrapped_at.
 *
 * Never throws — all errors are caught and returned as { status: 'error' }.
 *
 * @param {string}  spaceId
 * @param {string | undefined | null} workingDir - Absolute path to the repo root.
 * @param {object}  binding - folioBinding instance (provides createPage, hasFolio, getBootstrapState, setBootstrappedAt).
 * @param {object}  [opts]
 * @param {string}  [opts.dataDir]    - Root data directory (for temp files under runs/).
 * @param {string}  [opts.runId]      - Current run ID (used in temp file paths).
 * @param {number}  [opts.timeoutMs]  - Override for agent timeout.
 * @param {Array}   [opts._testPages] - Test-only: pages to inject in PIPELINE_NO_SPAWN=1 mode.
 * @returns {Promise<BootstrapResult>}
 */
async function ensureBootstrapped(spaceId, workingDir, binding, opts = {}) {
  const t0 = Date.now();

  try {
    // Guard 0: kill switch
    if (process.env.PRISM_FOLIO_BOOTSTRAP === 'off') {
      bootstrapLog('bootstrap.skipped', { spaceId, reason: 'kill-switch' });
      return { status: 'skipped', reason: 'kill-switch' };
    }

    // Guard 1: already bootstrapped (one-shot) — bypassed when opts.force, so the
    // manual "Bootstrap from repo" button always runs (explicit user intent),
    // even after a prior 0-page/failed attempt left a stale mark.
    const { bootstrappedAt } = binding.getBootstrapState(spaceId);
    if (bootstrappedAt && !opts.force) {
      return { status: 'skipped', reason: 'already-bootstrapped' };
    }

    // Guard 2: folio already exists → mark + skip (respects user curation)
    if (binding.hasFolio(spaceId)) {
      binding.setBootstrappedAt(spaceId, new Date().toISOString());
      bootstrapLog('bootstrap.skipped', { spaceId, reason: 'folio-exists' });
      return { status: 'skipped', reason: 'folio-exists', durationMs: Date.now() - t0 };
    }

    // Guard 3: no working directory or not a repo
    if (!detectRepo(workingDir)) {
      binding.setBootstrappedAt(spaceId, new Date().toISOString());
      bootstrapLog('bootstrap.skipped', { spaceId, reason: 'no-repo', workingDir: workingDir || '(none)' });
      return { status: 'skipped', reason: 'no-repo', durationMs: Date.now() - t0 };
    }

    // Repo detected — proceed to spawn
    const envTimeout = parseInt(process.env.PRISM_FOLIO_BOOTSTRAP_TIMEOUT, 10);
    const timeoutMs = opts.timeoutMs
      ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : BOOTSTRAP_CONFIG.defaultTimeoutMs);

    // Determine temp file paths
    const tmpDir = (opts.dataDir && opts.runId)
      ? path.join(opts.dataDir, 'runs', opts.runId)
      : fs.mkdtempSync(path.join(os.tmpdir(), 'prism-bootstrap-'));

    fs.mkdirSync(tmpDir, { recursive: true });

    const promptFile = path.join(tmpDir, 'bootstrap-prompt.md');
    const signalPath = path.join(tmpDir, 'bootstrap-signal.json');
    const doneFile   = path.join(tmpDir, 'bootstrap.done');

    // Persist prompt
    const promptText = buildBootstrapPrompt(workingDir, signalPath, doneFile);
    try {
      const tmpPrompt = promptFile + '.tmp';
      fs.writeFileSync(tmpPrompt, promptText, 'utf8');
      fs.renameSync(tmpPrompt, promptFile);
    } catch (err) {
      console.warn('[folio.bootstrap] WARN: could not persist prompt:', err.message);
    }

    // ── Test mode (PIPELINE_NO_SPAWN=1) ──────────────────────────────────────
    if (process.env.PIPELINE_NO_SPAWN === '1') {
      const testPages = Array.isArray(opts._testPages) ? opts._testPages : [];
      fs.writeFileSync(signalPath, JSON.stringify({ pages: testPages }), 'utf8');
      fs.writeFileSync(doneFile, '0', 'utf8');
      bootstrapLog('bootstrap.started', { spaceId, pid: null, mock: true });

      const { written, transientErrors } = applyBootstrapPages(spaceId, { pages: testPages }, workingDir, binding);
      const durationMs = Date.now() - t0;

      if (written === 0 && transientErrors > 0) {
        const result = { status: 'error', reason: 'transient_write_failure', transientErrors, durationMs };
        bootstrapLog('bootstrap.retry_pending', { spaceId, ...result });
        return result;
      }

      binding.setBootstrappedAt(spaceId, new Date().toISOString());

      if (written > 0) {
        const result = { status: 'bootstrapped', pagesWritten: written, durationMs };
        bootstrapLog('bootstrap.completed', { spaceId, ...result });
        return result;
      }
      const result = { status: 'skipped', reason: 'no-pages', durationMs };
      bootstrapLog('bootstrap.completed', { spaceId, ...result });
      return result;
    }

    // ── Real agent spawn ──────────────────────────────────────────────────────

    // Resolve folio-bootstrapper agent spec
    const agentsDir = process.env.PIPELINE_AGENTS_DIR;
    let agentSpec;
    try {
      agentSpec = resolveAgent('folio-bootstrapper', agentsDir);
    } catch (err) {
      if (err instanceof AgentNotFoundError) {
        binding.setBootstrappedAt(spaceId, new Date().toISOString());
        bootstrapLog('bootstrap.skipped', { spaceId, reason: 'agent_not_found' });
        return { status: 'skipped', reason: 'agent_not_found', durationMs: Date.now() - t0 };
      }
      throw err;
    }

    const hasPermissionMode = agentSpec.spawnArgs.includes('--permission-mode');
    const finalArgs = hasPermissionMode
      ? agentSpec.spawnArgs
      : [...agentSpec.spawnArgs, '--permission-mode', 'bypassPermissions'];

    // Default 'bootstrap.log'; the activation trigger passes 'stage-0.log' so the
    // run shows up as a single-stage run in the normal log viewer.
    const logPath = path.join(tmpDir, opts.logFile || 'bootstrap.log');

    const shellEscapeLocal = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
    const escapedArgs = finalArgs.map(shellEscapeLocal).join(' ');
    const shellCmd = [
      `_DONE=${shellEscapeLocal(doneFile)}`,
      `_SIGNAL=${shellEscapeLocal(signalPath)}`,
      '_EXIT=1',
      "trap '[ -e \"$_DONE\" ] || echo $_EXIT > \"$_DONE\"' EXIT",
      `${CLAUDE_BIN} ${escapedArgs} < ${shellEscapeLocal(promptFile)} >> ${shellEscapeLocal(logPath)} 2>&1`,
      '_EXIT=$?',
    ].join('; ');

    const child = spawn('sh', ['-c', shellCmd], {
      stdio:   'ignore',
      detached: true,
      cwd:     workingDir,
      env:     { ...process.env },
    });
    child.unref();

    if (process.platform === 'darwin' && child.pid) {
      const caff = spawn('caffeinate', ['-w', String(child.pid)], { stdio: 'ignore' });
      caff.unref();
    }

    bootstrapLog('bootstrap.started', { spaceId, pid: child.pid, workingDir });

    let spawnError = null;
    child.on('error', (err) => { spawnError = err; });

    // Wait (blocking-async) for the done-sentinel
    const exitCode = await waitForSentinel(doneFile, timeoutMs);

    if (spawnError) {
      binding.setBootstrappedAt(spaceId, new Date().toISOString());
      bootstrapLog('bootstrap.spawn_error', { spaceId, error: spawnError.message });
      return { status: 'error', reason: `spawn-failed: ${spawnError.message}`, durationMs: Date.now() - t0 };
    }

    if (exitCode !== 0) {
      // Agent reported failure or timed out — mark to avoid re-trying on next run.
      binding.setBootstrappedAt(spaceId, new Date().toISOString());
      bootstrapLog('bootstrap.agent_failed', { spaceId, exitCode });
      return { status: 'error', reason: 'agent_failed', durationMs: Date.now() - t0 };
    }

    // Parse signal file
    let agentOutput;
    try {
      const raw = fs.readFileSync(signalPath, 'utf8');
      agentOutput = JSON.parse(raw);
    } catch (err) {
      binding.setBootstrappedAt(spaceId, new Date().toISOString());
      bootstrapLog('bootstrap.parse_error', { spaceId, error: err.message });
      return { status: 'error', reason: `signal_parse_failed: ${err.message}`, durationMs: Date.now() - t0 };
    }

    // Apply pages (deterministic validation layer)
    const { written, transientErrors } = applyBootstrapPages(spaceId, agentOutput, workingDir, binding);
    const durationMs = Date.now() - t0;

    // Retry-worthy: nothing written AND the only failures were transient DB
    // contention (SQLITE_BUSY/LOCKED). Do NOT mark bootstrapped — let the next
    // pipeline run retry. A permanent failure or a legitimately empty result
    // (transientErrors === 0) falls through and IS marked, so we never loop.
    if (written === 0 && transientErrors > 0) {
      const result = { status: 'error', reason: 'transient_write_failure', transientErrors, durationMs };
      bootstrapLog('bootstrap.retry_pending', { spaceId, ...result });
      return result;
    }

    // Mark one-shot (final outcome)
    binding.setBootstrappedAt(spaceId, new Date().toISOString());

    if (written > 0) {
      const result = { status: 'bootstrapped', pagesWritten: written, durationMs };
      bootstrapLog('bootstrap.completed', { spaceId, ...result });
      return result;
    }

    const result = { status: 'skipped', reason: 'no-pages', durationMs };
    bootstrapLog('bootstrap.completed', { spaceId, ...result });
    return result;

  } catch (err) {
    // Safety net — ensureBootstrapped must never propagate into the pipeline.
    bootstrapLog('bootstrap.unexpected_error', { spaceId, error: err.message });
    console.warn('[folio.bootstrap] WARN: unexpected error in ensureBootstrapped:', err.message);
    return { status: 'error', reason: `unexpected: ${err.message}`, durationMs: Date.now() - t0 };
  }
}

// ---------------------------------------------------------------------------
// Background trigger (activation-time, NOT pipeline)
// ---------------------------------------------------------------------------

// Bootstrap-result reasons that mean the agent never spawned → nothing to show.
const NON_SPAWN_REASONS = new Set([
  'kill-switch', 'already-bootstrapped', 'folio-exists', 'no-repo', 'agent_not_found',
]);

/**
 * Finalise the agent-runs.jsonl record for a background bootstrap: mark it
 * completed/failed when the agent ran, or remove it when the bootstrap skipped
 * (so the Runs panel isn't polluted by no-op activations). Non-fatal.
 */
function finalizeBootstrapRunEntry(dataDir, entryId, result, startedAt) {
  try {
    const records = readAgentRuns(dataDir);
    const idx = records.findIndex((r) => r.id === entryId);
    if (idx === -1) return;

    if (NON_SPAWN_REASONS.has(result.reason)) {
      records.splice(idx, 1); // skipped → drop the row
    } else {
      const completedAt = new Date().toISOString();
      records[idx] = {
        ...records[idx],
        status:      result.status === 'bootstrapped' ? 'completed' : 'failed',
        completedAt,
        durationMs:  result.durationMs ?? (Date.parse(completedAt) - Date.parse(startedAt)),
        pagesWritten: result.pagesWritten,
      };
    }
    writeAgentRuns(dataDir, records);
  } catch (err) {
    console.warn('[folio.bootstrap] WARN: could not finalise bootstrap run entry:', err.message);
  }
}

/**
 * Build the single-stage run object persisted to the store so the bootstrap is
 * viewable through the normal run log viewer (getRun → stage-0.log). Marked
 * kind:'bootstrap' so it is filtered out of the pipeline run lists.
 */
function buildBootstrapRun(runId, spaceId, startedAt, status, stageStatus) {
  return {
    runId,
    spaceId,
    taskId:        '__bootstrap__',   // store column is NOT NULL; no FK to tasks
    kind:          'bootstrap',
    taskTitle:     'Bootstrap folio from repo',
    stages:        ['folio-bootstrapper'],
    stageStatuses: [stageStatus],
    currentStage:  0,
    status,
    createdAt:     startedAt,
    updatedAt:     new Date().toISOString(),
  };
}

/**
 * Fire-and-forget bootstrap triggered by activation (adding a working dir to a
 * space, or the manual "Bootstrap from repo" button) — NOT by the pipeline.
 *
 * Registers a single-stage run two ways so it is both listed and viewable:
 *   - agent-runs.jsonl  → the Runs panel list ("Folio Bootstrapper" row), and
 *   - a kind:'bootstrap' run in the store + stage-0.log/meta → the log viewer
 *     (getRun finds it; the kind marker keeps it out of pipeline run lists).
 * Both are finalised on completion, or removed if the bootstrap skipped (a no-op
 * activation) so nothing pollutes the UI. Returns the promise for tests.
 *
 * @param {{ spaceId: string, workingDir: string, binding: object, dataDir: string,
 *   spaceName?: string, runStore?: { upsert: (run) => void, remove: (runId) => void },
 *   _testPages?: Array }} args
 * @returns {Promise<BootstrapResult>}
 */
function triggerBackgroundBootstrap({ spaceId, workingDir, binding, dataDir, spaceName, runStore, force, _testPages }) {
  const runId     = `bootstrap-${spaceId}-${Date.now()}`;
  const entryId   = `${runId}-bootstrap`;
  const startedAt = new Date().toISOString();
  const dir       = path.join(dataDir, 'runs', runId);

  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* best-effort */ }

  // stage-0.meta.json so the events parser reads the claude-code stream.
  try {
    fs.writeFileSync(
      path.join(dir, 'stage-0.meta.json'),
      JSON.stringify({ source: 'claude-code', schemaVersion: 1, agentId: 'folio-bootstrapper', startedAt }),
      'utf8',
    );
  } catch (_) { /* parser falls back to first-line sniffing */ }

  // Store run (running) → the log viewer finds it via getRun.
  if (runStore) {
    try {
      runStore.upsert(buildBootstrapRun(runId, spaceId, startedAt, 'running',
        { status: 'running', startedAt, finishedAt: null, exitCode: null, pid: null }));
    } catch (err) {
      console.warn('[folio.bootstrap] WARN: could not persist bootstrap run:', err.message);
    }
  }

  // Runs-history entry (the panel reads agent-runs.jsonl).
  try {
    const entry = {
      id:               entryId,
      pipelineRunId:    runId,
      stageIndex:       0,
      taskId:           null,
      taskTitle:        'Bootstrap folio from repo',
      agentId:          'folio-bootstrapper',
      agentDisplayName: 'Folio Bootstrapper',
      spaceId,
      spaceName:        spaceName || '',
      phase:            'bootstrap',
      status:           'running',
      startedAt,
      completedAt:      null,
      durationMs:       null,
    };
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(path.join(dataDir, 'agent-runs.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.warn('[folio.bootstrap] WARN: could not write bootstrap run entry:', err.message);
  }

  return (async () => {
    let result;
    try {
      result = await ensureBootstrapped(spaceId, workingDir, binding, { dataDir, runId, logFile: 'stage-0.log', force, _testPages });
    } catch (err) {
      result = { status: 'error', reason: `unexpected: ${err.message}`, durationMs: Date.now() - Date.parse(startedAt) };
    }

    const skipped    = NON_SPAWN_REASONS.has(result.reason);
    const finishedAt = new Date().toISOString();

    // Finalise (or remove on a no-op skip) the store run.
    if (runStore) {
      try {
        if (skipped) {
          runStore.remove(runId);
        } else {
          const ok = result.status === 'bootstrapped';
          runStore.upsert(buildBootstrapRun(runId, spaceId, startedAt, ok ? 'completed' : 'failed',
            { status: ok ? 'completed' : 'failed', startedAt, finishedAt, exitCode: ok ? 0 : 1, pid: null }));
        }
      } catch (err) {
        console.warn('[folio.bootstrap] WARN: could not finalise bootstrap run:', err.message);
      }
    }

    finalizeBootstrapRunEntry(dataDir, entryId, result, startedAt);
    return result;
  })();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  triggerBackgroundBootstrap,
  detectRepo,
  buildBootstrapPrompt,
  applyBootstrapPages,
  ensureBootstrapped,
  BOOTSTRAP_CONFIG,
};
