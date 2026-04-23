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
