/**
 * useAgentPersonalityStore — Zustand store for agent personality profiles.
 *
 * ADR-1 (agent-personalities) §3.3 blueprint slice spec.
 *
 * State shape:
 *   personalities:  Record<agentId, AgentPersonality>  — the registry
 *   loading:        boolean                             — fetchAll in flight
 *   generating:     Record<agentId, boolean>            — per-agent generate flag
 *   mcpServers:     McpServer[]                         — discovered servers
 *
 * All async actions surface errors via the app-level toast.
 * Optimistic updates: save updates state immediately and rolls back on failure.
 */

import { create } from 'zustand';
import * as api from '@/api/client';
import type { AgentPersonality, AgentPersonalityInput, McpServer } from '@/types';

// We call showToast via a late-bound getter to avoid circular-import with useAppStore.
// At runtime, useAppStore is available because Zustand stores are module singletons.
// Using a getter function rather than require() to stay ESM-compatible.
let _appStoreGetter: (() => { showToast: (m: string, t: string) => void }) | null = null;

/** Register the showToast accessor from useAppStore. Called lazily on first use. */
function _getAppStore() {
  if (!_appStoreGetter) {
    // Late import breaks the circular dependency cycle at module evaluation time.
    // Both modules are fully evaluated before this function runs.
    import('@/stores/useAppStore').then(({ useAppStore }) => {
      _appStoreGetter = () => useAppStore.getState() as { showToast: (m: string, t: string) => void };
    }).catch(() => {});
  }
  return _appStoreGetter?.();
}

function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  try {
    _getAppStore()?.showToast(message, type);
  } catch {
    // Store not yet mounted — ignore
  }
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface AgentPersonalityState {
  personalities: Record<string, AgentPersonality>;
  loading: boolean;
  generating: Record<string, boolean>;
  mcpServers: McpServer[];

  /** Load all personalities from the backend. Resets loading flag on finish. */
  fetchAll: () => Promise<void>;

  /**
   * Create or replace a personality. Optimistically updates state and rolls
   * back on error with a toast notification.
   */
  save: (agentId: string, input: AgentPersonalityInput) => Promise<void>;

  /** Delete a personality. Removes it from local state immediately. */
  remove: (agentId: string) => Promise<void>;

  /**
   * Ask the LLM to generate a personality proposal. Does NOT persist —
   * caller must call save() with the result if desired.
   * Sets generating[agentId] = true while in flight.
   */
  generate: (agentId: string, hint?: string) => Promise<AgentPersonality>;

  /** Discover MCP tool servers. Populates mcpServers. */
  fetchMcp: (workingDirectory?: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useAgentPersonalityStore = create<AgentPersonalityState>((set, get) => ({
  personalities: {},
  loading: false,
  generating: {},
  mcpServers: [],

  fetchAll: async () => {
    set({ loading: true });
    try {
      const list = await api.listAgentPersonalities();
      const map: Record<string, AgentPersonality> = {};
      for (const p of list) {
        map[p.agentId] = p;
      }
      set({ personalities: map });
    } catch (err) {
      console.error('[useAgentPersonalityStore] fetchAll failed:', (err as Error).message);
      // Don't surface fetchAll errors as toast — page renders empty state instead
    } finally {
      set({ loading: false });
    }
  },

  save: async (agentId, input) => {
    const prev = get().personalities[agentId];
    // Optimistic update — create a temporary record so the UI reacts immediately
    const optimistic: AgentPersonality = {
      agentId,
      displayName: input.displayName,
      color: input.color,
      persona: input.persona ?? '',
      mcpTools: input.mcpTools,
      avatar: input.avatar,
      source: input.source ?? 'manual',
      generatedAt: input.generatedAt,
      updatedAt: new Date().toISOString(),
    };
    set((s) => ({ personalities: { ...s.personalities, [agentId]: optimistic } }));
    try {
      const saved = await api.upsertAgentPersonality(agentId, input);
      set((s) => ({ personalities: { ...s.personalities, [agentId]: saved } }));
      showToast('Personality saved', 'success');
    } catch (err) {
      // Roll back optimistic update
      set((s) => {
        const next = { ...s.personalities };
        if (prev) {
          next[agentId] = prev;
        } else {
          delete next[agentId];
        }
        return { personalities: next };
      });
      const message = (err as Error).message || 'Failed to save personality.';
      showToast(message, 'error');
      throw err;
    }
  },

  remove: async (agentId) => {
    const prev = get().personalities[agentId];
    // Optimistic removal
    set((s) => {
      const next = { ...s.personalities };
      delete next[agentId];
      return { personalities: next };
    });
    try {
      await api.deleteAgentPersonality(agentId);
      showToast('Personality removed', 'success');
    } catch (err) {
      // Roll back
      if (prev) {
        set((s) => ({ personalities: { ...s.personalities, [agentId]: prev } }));
      }
      const message = (err as Error).message || 'Failed to remove personality.';
      showToast(message, 'error');
      throw err;
    }
  },

  generate: async (agentId, hint) => {
    set((s) => ({ generating: { ...s.generating, [agentId]: true } }));
    try {
      const proposal = await api.generateAgentPersonality(agentId, hint);
      // Return as AgentPersonality-compatible object (without agentId/source/updatedAt)
      return {
        agentId,
        displayName: proposal.displayName,
        color: proposal.color,
        persona: proposal.persona,
        mcpTools: proposal.mcpTools,
        avatar: proposal.avatar,
        source: 'generated' as const,
        generatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } catch (err) {
      const message = (err as Error).message || 'Failed to generate personality.';
      showToast(message, 'error');
      throw err;
    } finally {
      set((s) => {
        const next = { ...s.generating };
        delete next[agentId];
        return { generating: next };
      });
    }
  },

  fetchMcp: async (workingDirectory) => {
    try {
      const result = await api.discoverMcpTools(workingDirectory);
      set({ mcpServers: result.servers });
    } catch (err) {
      console.error('[useAgentPersonalityStore] fetchMcp failed:', (err as Error).message);
    }
  },
}));
