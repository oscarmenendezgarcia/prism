'use strict';

/**
 * personalityGenerator — LLM-backed personality proposal generation
 *
 * Wraps the `callCLI` pattern from autoTask.js:
 *   1. Reads the agent .md file (up to 1 500 chars excerpt).
 *   2. Builds a focused system prompt asking for strict JSON output.
 *   3. Spawns `claude --print` (or configured CLI) with 30 s timeout.
 *   4. Validates + normalises the response (color snap-to-nearest-palette).
 *   5. Returns { valid, errors, data } so callers always get a typed result.
 *
 * The `data` field matches the AgentPersonalityProposal schema:
 *   { displayName, persona, color, mcpTools, avatar }
 */

const fs            = require('fs');
const path          = require('path');
const os            = require('os');
const { spawn }     = require('child_process');
const { readSettings } = require('../handlers/settings');

// ---------------------------------------------------------------------------
// Curated color palette (16 swatches — frozen, from ADR-1)
// ---------------------------------------------------------------------------

const CURATED_PALETTE = [
  '#7C3AED', '#2563EB', '#0EA5E9', '#0D9488',
  '#16A34A', '#65A30D', '#CA8A04', '#EA580C',
  '#DC2626', '#DB2777', '#9333EA', '#475569',
  '#0F766E', '#1D4ED8', '#A16207', '#BE123C',
];

/**
 * Validate that a hex color is in the curated palette (case-insensitive).
 * @param {string} hex
 * @returns {boolean}
 */
function isInPalette(hex) {
  return CURATED_PALETTE.map((c) => c.toUpperCase()).includes(hex.toUpperCase());
}

/**
 * Convert a hex color to [L, a, b] in CIELAB space (simplified approximation).
 * Good enough for nearest-neighbor selection among 16 fixed swatches.
 * @param {string} hex
 * @returns {[number, number, number]}
 */
function hexToLab(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  // sRGB to linear
  function lin(c) { return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
  const rl = lin(r), gl = lin(g), bl = lin(b);

  // Linear RGB to XYZ (D65)
  const X = (0.4124 * rl + 0.3576 * gl + 0.1805 * bl) / 0.95047;
  const Y = (0.2126 * rl + 0.7152 * gl + 0.0722 * bl) / 1.00000;
  const Z = (0.0193 * rl + 0.1192 * gl + 0.9505 * bl) / 1.08883;

  // XYZ to Lab
  function f(t) { return t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116; }
  const L = 116 * f(Y) - 16;
  const a = 500 * (f(X) - f(Y));
  const bv = 200 * (f(Y) - f(Z));
  return [L, a, bv];
}

/**
 * Find the palette swatch nearest to `hex` using Euclidean Lab distance.
 * @param {string} hex
 * @returns {string} A color from CURATED_PALETTE
 */
function snapToNearestPalette(hex) {
  let best = CURATED_PALETTE[0];
  let bestDist = Infinity;
  const [L1, a1, b1] = hexToLab(hex);
  for (const swatch of CURATED_PALETTE) {
    const [L2, a2, b2] = hexToLab(swatch);
    const dist = (L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2;
    if (dist < bestDist) { bestDist = dist; best = swatch; }
  }
  return best;
}

/**
 * Ensure a color is in the palette; if not, snap to nearest match.
 * @param {string} color
 * @returns {string}
 */
function validateOrSnapColor(color) {
  if (!color || typeof color !== 'string') return CURATED_PALETTE[0];
  const upper = color.toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(upper)) return snapToNearestPalette(CURATED_PALETTE[0]);
  if (isInPalette(upper)) return upper;
  return snapToNearestPalette(upper);
}

// ---------------------------------------------------------------------------
// MCP tool prefix validation
// ---------------------------------------------------------------------------

const MCP_TOOL_RE = /^mcp__[a-z0-9_-]+__\*$/;

function validateMcpTools(tools) {
  if (!Array.isArray(tools)) return ['mcp__prism__*'];
  return tools.filter((t) => typeof t === 'string' && MCP_TOOL_RE.test(t));
}

// ---------------------------------------------------------------------------
// Agent file reader
// ---------------------------------------------------------------------------

const AGENTS_DIR_DEFAULT = path.join(os.homedir(), '.claude', 'agents');
const EXCERPT_MAX        = 1500;

/**
 * Read up to EXCERPT_MAX characters from an agent .md file.
 * @param {string} agentId
 * @returns {{ found: boolean, content: string, path: string }}
 */
function readAgentFile(agentId) {
  const agentsDir = process.env.PIPELINE_AGENTS_DIR
    ? (process.env.PIPELINE_AGENTS_DIR.startsWith('~')
      ? process.env.PIPELINE_AGENTS_DIR.replace('~', os.homedir())
      : process.env.PIPELINE_AGENTS_DIR)
    : AGENTS_DIR_DEFAULT;

  const filePath = path.join(agentsDir, `${agentId}.md`);
  if (!fs.existsSync(filePath)) return { found: false, content: '', path: filePath };
  try {
    const raw     = fs.readFileSync(filePath, 'utf8');
    const content = raw.length > EXCERPT_MAX ? raw.slice(0, EXCERPT_MAX) + '\n...(truncated)' : raw;
    return { found: true, content, path: filePath };
  } catch (err) {
    console.warn(`[personalityGenerator] Could not read ${filePath}: ${err.message}`);
    return { found: false, content: '', path: filePath };
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const PALETTE_LIST = CURATED_PALETTE.join(', ');

function buildSystemPrompt(agentId, agentContent, hint, availableTools) {
  const toolsList = availableTools.length > 0 ? availableTools.join(', ') : 'mcp__prism__*';
  const hintLine  = hint ? `User style hint: "${hint}"` : '';

  return `You create quirky, funny character bios for AI agents in a tool called Prism.
Think Animal Crossing villager meets tech Twitter. Each agent has a distinct personality, a slightly ridiculous backstory, and speaks in a way only they would.

Agent ID: "${agentId}"
Agent definition file:
---
${agentContent || '(no file — infer from the agent ID)'}
---
${hintLine}

Available MCP tools: ${toolsList}

Tone rules for the persona field:
- Write like a funny character bio, not a job description. One or two sentences max.
- Give them a quirk, a hobby, or an absurd detail that fits their role. Be specific and weird.
- Examples of the vibe:
  • developer-agent → "Hasn't left the house since 2019 but top-ranked in 4 online games simultaneously. Refactors code at 2am for fun, not profit."
  • senior-architect → "Draws system diagrams nobody reads, then turns out to be right about everything 6 months later. Communicates exclusively in ADRs."
  • ux-api-designer → "Cried at a perfectly kerned font once. Has strong opinions about your button padding and will tell you about them unprompted."
  • qa-engineer-e2e → "Finds the bug you introduced while fixing the last bug. Keeps a personal spreadsheet of every broken deploy. Smiles when things fail."
  • code-reviewer → "Knows every RFC by heart. Will leave 40 comments on a 3-line PR. Means it lovingly."
- The persona should feel like something this agent would say about themselves — half-bragging, half-self-aware.
- Keep it under 280 characters. Punchy beats thorough.

Return ONLY a single valid JSON object:
{
  "displayName": "<catchy 1-60 char name — can be a nickname or a title>",
  "persona": "<funny character bio, ≤280 chars>",
  "color": "<one hex from: ${PALETTE_LIST}>",
  "mcpTools": ["<relevant prefixes from available list — always include mcp__prism__*>"],
  "avatar": "<1-2 emoji that match the vibe>"
}

Hard rules:
- displayName: 1-60 chars, no newlines.
- color MUST be exactly one of the listed hex values — no other values.
- mcpTools must be a subset of the available prefixes.
- avatar: 1-2 grapheme clusters (emoji preferred).
- Output ONLY the JSON object — no markdown, no explanation, no code fences.
- persona must be 280 characters or fewer. Punchy beats thorough.`;
}

// legacy alias so existing callers that pass persona through still validate
const PERSONA_MAX_GENERATED = 280;

// ---------------------------------------------------------------------------
// CLI caller (mirrors callCLI in autoTask.js)
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 120_000;

/**
 * Spawn the Claude CLI and return its parsed JSON output.
 * @param {string} userPrompt
 * @param {string} systemPrompt
 * @returns {Promise<object>}
 */
function callPersonalityCLI(userPrompt, systemPrompt, dataDir) {
  const settings = readSettings(dataDir || path.join(__dirname, '..', '..', 'data'));
  const cli   = settings?.cli?.binary || settings?.cli?.tool || 'claude';
  const model = settings?.cli?.model  || 'haiku';

  return new Promise((resolve, reject) => {
    let timer;
    const child = spawn(
      cli,
      [
        '--print',
        '--system-prompt', systemPrompt,
        '--model', model,
        '--dangerously-skip-permissions',
        '--no-session-persistence',
      ],
      { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';

    timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('TIMEOUT: Claude CLI did not respond within 30 seconds.'));
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn '${cli}': ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`'${cli}' exited with code ${code}: ${stderr.slice(0, 300)}`));
        return;
      }

      // Handle stream-json (claude --print default) and plain text fallback
      let text = '';
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            text += event.delta.text;
          }
        } catch { /* ignore non-JSON streaming lines */ }
      }

      const rawOutput = text || stdout;

      // Extract JSON object from output
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        reject(new Error(`No JSON found in CLI output: ${rawOutput.slice(0, 200)}`));
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        reject(new Error(`CLI returned non-JSON: ${rawOutput.slice(0, 200)}`));
        return;
      }

      resolve(parsed);
    });

    child.stdin.write(userPrompt);
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate a personality proposal for the given agentId using the LLM.
 *
 * @param {object} options
 * @param {string}   options.agentId
 * @param {string}  [options.hint]             Optional user hint for personality style
 * @param {string[]}[options.availableTools]   MCP tool prefixes from mcpDiscovery
 * @param {string}  [options.dataDir]           Path to data directory (for settings)
 * @returns {Promise<{ valid: boolean, errors: string[], data: object | null }>}
 */
async function generatePersonality({ agentId, hint, availableTools = [], dataDir }) {
  const agentFile  = readAgentFile(agentId);
  const systemPrompt = buildSystemPrompt(agentId, agentFile.content, hint, availableTools);
  const userPrompt   = `Generate a personality profile for agent: ${agentId}${hint ? `. Style hint: ${hint}` : ''}.`;

  let raw;
  try {
    raw = await callPersonalityCLI(userPrompt, systemPrompt, dataDir);
  } catch (err) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      evt: 'personality.generate',
      agentId,
      ok: false,
      error: err.message,
    }));
    return { valid: false, errors: [err.message], data: null };
  }

  // ── Validate and normalise ──
  const errors = [];

  // displayName
  const displayName = typeof raw.displayName === 'string' ? raw.displayName.trim() : '';
  if (!displayName) errors.push('displayName is required');
  if (displayName.length > 60) errors.push('displayName exceeds 60 characters');

  // persona
  const persona = typeof raw.persona === 'string' ? raw.persona : '';
  if (persona.length > 600) errors.push('persona exceeds 600 characters');

  // color — snap to nearest palette entry
  const color = validateOrSnapColor(raw.color);

  // mcpTools
  const mcpTools = validateMcpTools(raw.mcpTools);
  if (!mcpTools.includes('mcp__prism__*')) mcpTools.unshift('mcp__prism__*');

  // avatar
  const avatar = typeof raw.avatar === 'string' ? raw.avatar.slice(0, 4) : '';

  if (errors.length > 0) {
    return { valid: false, errors, data: null };
  }

  const data = { displayName, persona, color, mcpTools, avatar };

  console.info(JSON.stringify({
    ts: new Date().toISOString(),
    evt: 'personality.generate',
    agentId,
    ok: true,
    color,
    mcpTools,
  }));

  return { valid: true, errors: [], data };
}

module.exports = {
  generatePersonality,
  validateOrSnapColor,
  snapToNearestPalette,
  isInPalette,
  CURATED_PALETTE,
  readAgentFile,
};
