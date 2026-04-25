/**
 * useAgentColor — pure Zustand selector hook
 *
 * Returns the color, displayName, persona, and avatar for a given agentId
 * by selecting directly from useAgentPersonalityStore.
 *
 * Returns all `undefined` fields when no personality is saved for the agentId,
 * so callers can fall back to neutral styling without branching logic.
 *
 * Performance: the selector equality check is object-identity — the return value
 * object is recreated only when the specific agentId entry changes. This prevents
 * all TaskCards from re-rendering when an unrelated personality changes.
 */

import { useAgentPersonalityStore } from '@/stores/useAgentPersonalityStore';

export interface AgentColorInfo {
  color: string | undefined;
  displayName: string | undefined;
  persona: string | undefined;
  avatar: string | undefined;
}

/**
 * Selector hook — returns personality display info for a given agentId.
 *
 * @param agentId - Kebab-case agent ID (e.g. "senior-architect"). May be null/undefined.
 * @returns AgentColorInfo with defined fields when a personality exists, all undefined otherwise.
 */
export function useAgentColor(agentId: string | null | undefined): AgentColorInfo {
  const personality = useAgentPersonalityStore(
    (s) => (agentId ? s.personalities[agentId] : undefined),
  );

  if (!personality) {
    return { color: undefined, displayName: undefined, persona: undefined, avatar: undefined };
  }

  return {
    color:       personality.color,
    displayName: personality.displayName,
    persona:     personality.persona,
    avatar:      personality.avatar,
  };
}
