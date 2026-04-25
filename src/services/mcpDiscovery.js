'use strict';

/**
 * mcpDiscovery — merge MCP server definitions from multiple sources
 *
 * Sources (in priority order — later overrides earlier on same id):
 *   1. built-in   — mcp__prism__*   (always present)
 *   2. ~/.claude.json → mcpServers  (per-project blocks; filtered to workingDirectory if provided)
 *   3. ~/.claude/settings.json → enabledPlugins  (global plugin map)
 *   4. <workingDirectory>/.mcp.json              (project-local override)
 *
 * Each source is wrapped in try/catch so a missing or malformed file does NOT
 * break discovery — it simply contributes nothing and logs a warning.
 *
 * Returns: [{ id, source, toolPrefix, description? }]
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ---------------------------------------------------------------------------
// Built-ins (always present)
// ---------------------------------------------------------------------------

/** @type {Array<{ id: string, source: string, toolPrefix: string, description: string }>} */
const BUILT_IN_SERVERS = [
  {
    id:          'prism',
    source:      'built-in',
    toolPrefix:  'mcp__prism__*',
    description: 'Kanban, tasks, pipeline operations',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Expand a leading `~` to the user home directory.
 * @param {string} p
 * @returns {string}
 */
function expandTilde(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return os.homedir() + p.slice(1);
  return p;
}

/**
 * Safely read + parse a JSON file. Returns null if missing or invalid.
 * @param {string} filePath
 * @returns {object | null}
 */
function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[mcpDiscovery] Could not read ${filePath}: ${err.message}`);
    return null;
  }
}

/**
 * Convert a raw server name to a tool prefix.
 * Examples:
 *   "prism"          → "mcp__prism__*"
 *   "playwright"     → "mcp__plugin_playwright__*"   (plugins add the plugin_ prefix)
 *   "figma"          → "mcp__figma__*"
 *
 * The "plugin_" infix is applied for servers sourced from enabledPlugins where the
 * server name is a plugin name (non-namespaced). Servers from mcpServers keep the
 * raw id as their prefix key.
 *
 * @param {string} name - Raw server/plugin name
 * @param {boolean} [isPlugin=false] - Whether this came from enabledPlugins
 * @returns {string}
 */
function toToolPrefix(name, isPlugin = false) {
  const safe = name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  if (isPlugin) {
    return `mcp__plugin_${safe}__*`;
  }
  return `mcp__${safe}__*`;
}

// ---------------------------------------------------------------------------
// Source parsers
// ---------------------------------------------------------------------------

/**
 * Parse ~/.claude.json → mcpServers.
 * That file contains a top-level `projects` map keyed by absolute path, each
 * project having an `mcpServers` object.  When workingDirectory is supplied, we
 * only return servers for the matching project entry (falling back to a global
 * `mcpServers` key if it exists at the top level).
 *
 * @param {string | null} workingDirectory
 * @returns {Array<{ id, source, toolPrefix }>}
 */
function _parseDotClaudeJson(workingDirectory) {
  const filePath = path.join(os.homedir(), '.claude.json');
  const data     = safeReadJson(filePath);
  if (!data || typeof data !== 'object') return [];

  const results = [];

  // 1. Global mcpServers at root level (some older CLI versions store it here)
  if (data.mcpServers && typeof data.mcpServers === 'object') {
    for (const [name] of Object.entries(data.mcpServers)) {
      results.push({
        id:         name,
        source:     '~/.claude.json',
        toolPrefix: toToolPrefix(name),
      });
    }
  }

  // 2. Per-project mcpServers — only if workingDirectory matches
  if (workingDirectory && data.projects && typeof data.projects === 'object') {
    const projectEntry = data.projects[workingDirectory];
    if (projectEntry && projectEntry.mcpServers && typeof projectEntry.mcpServers === 'object') {
      for (const [name] of Object.entries(projectEntry.mcpServers)) {
        // Overwrite any global entry with the same id
        const existing = results.findIndex((r) => r.id === name);
        const entry    = { id: name, source: '~/.claude.json', toolPrefix: toToolPrefix(name) };
        if (existing >= 0) {
          results[existing] = entry;
        } else {
          results.push(entry);
        }
      }
    }
  }

  return results;
}

/**
 * Parse ~/.claude/settings.json → enabledPlugins.
 * That map is either `{ pluginName: true }` or `{ pluginName: { enabled: true, ... } }`.
 *
 * @returns {Array<{ id, source, toolPrefix }>}
 */
function _parseDotClaudeSettings() {
  const filePath = path.join(os.homedir(), '.claude', 'settings.json');
  const data     = safeReadJson(filePath);
  if (!data || typeof data !== 'object') return [];

  const plugins = data.enabledPlugins;
  if (!plugins || typeof plugins !== 'object') return [];

  const results = [];
  for (const [name, val] of Object.entries(plugins)) {
    const enabled = val === true || (typeof val === 'object' && val.enabled !== false);
    if (!enabled) continue;
    results.push({
      id:         name,
      source:     '~/.claude/settings.json',
      toolPrefix: toToolPrefix(name, true),
    });
  }
  return results;
}

/**
 * Parse <workingDirectory>/.mcp.json.
 * Schema: { mcpServers: { name: { command, args, env } } }
 *
 * @param {string | null} workingDirectory
 * @returns {Array<{ id, source, toolPrefix }>}
 */
function _parseMcpJson(workingDirectory) {
  if (!workingDirectory) return [];
  const filePath = path.join(workingDirectory, '.mcp.json');
  const data     = safeReadJson(filePath);
  if (!data || !data.mcpServers || typeof data.mcpServers !== 'object') return [];

  return Object.keys(data.mcpServers).map((name) => ({
    id:         name,
    source:     '.mcp.json',
    toolPrefix: toToolPrefix(name),
  }));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Discover and merge MCP server definitions from all sources.
 *
 * @param {string | null} [workingDirectory=null] - Optional absolute path used to
 *   resolve project-local .mcp.json and per-project entries in ~/.claude.json.
 * @returns {{ servers: Array<{ id: string, source: string, toolPrefix: string, description?: string }> }}
 */
function discoverMcpTools(workingDirectory = null) {
  /** @type {Map<string, object>} keyed by id; later sources win */
  const merged = new Map();

  // 1. Built-ins (always present, lowest priority)
  for (const s of BUILT_IN_SERVERS) {
    merged.set(s.id, s);
  }

  // 2. ~/.claude.json (per-project or global mcpServers block)
  try {
    for (const s of _parseDotClaudeJson(workingDirectory)) {
      merged.set(s.id, s);
    }
  } catch (err) {
    console.warn('[mcpDiscovery] ~.claude.json parse error:', err.message);
  }

  // 3. ~/.claude/settings.json → enabledPlugins
  try {
    for (const s of _parseDotClaudeSettings()) {
      merged.set(s.id, s);
    }
  } catch (err) {
    console.warn('[mcpDiscovery] settings.json parse error:', err.message);
  }

  // 4. <wd>/.mcp.json (project-local, highest priority)
  try {
    for (const s of _parseMcpJson(workingDirectory)) {
      merged.set(s.id, s);
    }
  } catch (err) {
    console.warn('[mcpDiscovery] .mcp.json parse error:', err.message);
  }

  return { servers: [...merged.values()] };
}

module.exports = {
  discoverMcpTools,
  // Exported for unit tests
  _parseDotClaudeJson,
  _parseDotClaudeSettings,
  _parseMcpJson,
  toToolPrefix,
};
