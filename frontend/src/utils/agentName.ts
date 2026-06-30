/**
 * agentName.ts — utility for resolving agent display names and short labels.
 *
 * ADR-1 (agent-nicknames): nicknames are a UI concern only. Resolution follows
 * a fallback chain so that spaces with no nicknames degrade gracefully to the
 * existing static label maps.
 */

import type { Space } from '@/types';

// ---------------------------------------------------------------------------
// Static label maps — single source of truth (moved from RunIndicator / StageTabBar)
// ---------------------------------------------------------------------------

/** Full display names for well-known agent IDs. */
export const STAGE_DISPLAY: Record<string, string> = {
  'senior-architect': 'Senior Architect',
  'ux-api-designer':  'UX / API Designer',
  'developer-agent':  'Developer Agent',
  'qa-engineer-e2e':  'QA Engineer E2E',
  'code-reviewer':    'Code Reviewer',
};

/**
 * Role subtitles for the Proposal D "Agents & Routing" view.
 * One line, English, concise — distinct from STAGE_DISPLAY (full names).
 * These appear as the secondary line inside each AgentRoutingCard.
 */
export const STAGE_ROLES: Record<string, string> = {
  'senior-architect': 'Architecture · ADR + blueprint',
  'ux-api-designer':  'UX + API spec',
  'developer-agent':  'Implementation',
  'code-reviewer':    'Code review',
  'qa-engineer-e2e':  'QA E2E',
  'orchestrator':     'Pipeline orchestration',
};

/** Short labels (≤ 8 chars) for well-known agent IDs. */
export const STAGE_LABELS: Record<string, string> = {
  'senior-architect': 'Architect',
  'ux-api-designer':  'UX',
  'developer-agent':  'Dev',
  'qa-engineer-e2e':  'QA',
  'code-reviewer':    'Rev',
  'orchestrator':     'Orch',
};

// ---------------------------------------------------------------------------
// Agent dot colour — deterministic per agent ID (mirrors arcColor in utils/arcs)
// ---------------------------------------------------------------------------

/**
 * Solid dot colours for the agent indicator. Full Tailwind class strings (not
 * interpolated) so the JIT keeps them. Error red is excluded to avoid clashing
 * with the bug/error semantic colour.
 */
const AGENT_DOT_COLORS: string[] = [
  'bg-violet-500', 'bg-sky-500',   'bg-emerald-500', 'bg-amber-500',
  'bg-pink-500',   'bg-blue-500',  'bg-teal-500',    'bg-fuchsia-500',
  'bg-rose-400',   'bg-cyan-500',  'bg-lime-500',    'bg-indigo-500',
];

/**
 * Deterministic dot colour for an agent — same agent ID always gets the same
 * colour, unique-ish across agents (same djb2 hash as {@link arcColor}). No
 * hardcoded per-agent map: add or rename an agent and it just gets a colour.
 */
export function agentDotColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) hash = agentId.charCodeAt(i) + ((hash << 5) - hash);
  return AGENT_DOT_COLORS[Math.abs(hash) % AGENT_DOT_COLORS.length];
}

// ---------------------------------------------------------------------------
// AgentInfo — minimal interface matching what useAvailableAgents() returns
// ---------------------------------------------------------------------------

export interface AgentInfo {
  id: string;
  displayName?: string;
}

// ---------------------------------------------------------------------------
// Resolver functions
// ---------------------------------------------------------------------------

/**
 * Resolve the full display name for an agent, using a four-level fallback chain:
 *
 *  1. space.agentNicknames[agentId]  — user-defined nickname for this space
 *  2. STAGE_DISPLAY[agentId]         — built-in full name
 *  3. agents[].displayName           — metadata from the agents API
 *  4. agentId                        — raw ID (last resort)
 *
 * @param agentId   The agent's kebab-case identifier.
 * @param space     The active space (or null / undefined if unavailable).
 * @param agents    Optional agent info list from the agents API.
 */
export function resolveAgentName(
  agentId: string,
  space: Space | null | undefined,
  agents?: AgentInfo[],
): string {
  // Level 1: space-level nickname (non-empty after trim)
  const nickname = space?.agentNicknames?.[agentId];
  if (nickname && nickname.trim().length > 0) return nickname.trim();

  // Level 2: static display map
  const staticName = STAGE_DISPLAY[agentId];
  if (staticName) return staticName;

  // Level 3: agent metadata displayName
  const agentMeta = agents?.find((a) => a.id === agentId);
  if (agentMeta?.displayName) return agentMeta.displayName;

  // Level 4: raw ID
  return agentId;
}

/**
 * Resolve a short label (suitable for tight UI contexts like step nodes or tabs)
 * using a three-level fallback chain:
 *
 *  1. Nickname truncated to 6 characters + '…' if longer
 *  2. STAGE_LABELS[agentId]  — built-in short label
 *  3. agentId.split('-')[0]  — first word of the ID
 *
 * @param agentId   The agent's kebab-case identifier.
 * @param space     The active space (or null / undefined if unavailable).
 */
export function resolveAgentShortLabel(
  agentId: string,
  space: Space | null | undefined,
): string {
  // Level 1: nickname (non-empty) truncated to 6 chars
  const nickname = space?.agentNicknames?.[agentId];
  if (nickname && nickname.trim().length > 0) {
    const trimmed = nickname.trim();
    return trimmed.length > 6 ? `${trimmed.slice(0, 6)}…` : trimmed;
  }

  // Level 2: static short label
  const staticLabel = STAGE_LABELS[agentId];
  if (staticLabel) return staticLabel;

  // Level 3: first segment of the ID
  return agentId.split('-')[0] ?? agentId;
}
