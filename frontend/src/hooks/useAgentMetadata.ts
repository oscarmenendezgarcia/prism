/**
 * useAgentMetadata — fetch and cache parsed frontmatter for a list of agent IDs.
 *
 * Fetches GET /agents/:id in parallel for each agentId, parses the frontmatter
 * (model, effort, skills) and caches the result by agentId. Results are cached
 * in a module-level WeakRef-free cache (Map) so repeated calls within the same
 * session skip the network.
 *
 * Phase 1: read-only. No write-back.
 */

import { useState, useEffect } from 'react';
import * as api from '@/api/client';
import { parseAgentFrontmatter } from '@/utils/parseAgentFrontmatter';
import type { AgentFrontmatter } from '@/utils/parseAgentFrontmatter';

// ---------------------------------------------------------------------------
// Module-level cache — survives re-renders, invalidated only on page reload
// ---------------------------------------------------------------------------

const cache = new Map<string, AgentFrontmatter>();
// In-flight promises to dedupe concurrent fetches for the same agentId
const inflight = new Map<string, Promise<AgentFrontmatter>>();

async function fetchAndParse(agentId: string): Promise<AgentFrontmatter> {
  if (cache.has(agentId)) return cache.get(agentId)!;
  if (inflight.has(agentId)) return inflight.get(agentId)!;

  const p = api.getAgent(agentId)
    .then((detail) => {
      const parsed = parseAgentFrontmatter(detail.content);
      cache.set(agentId, parsed);
      return parsed;
    })
    .catch((err) => {
      console.warn(`[useAgentMetadata] failed to fetch agent "${agentId}":`, err);
      const fallback: AgentFrontmatter = { skills: [] };
      cache.set(agentId, fallback);
      return fallback;
    })
    .finally(() => {
      inflight.delete(agentId);
    });

  inflight.set(agentId, p);
  return p;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface AgentMetadataEntry extends AgentFrontmatter {
  loading: boolean;
}

export type AgentMetadataMap = Record<string, AgentMetadataEntry>;

/**
 * Returns a map of agentId → { model?, effort?, skills[], loading } for each
 * agentId in the provided list. Fetches in parallel; lazy — fetches only when
 * agentIds changes or a cache miss occurs.
 */
export function useAgentMetadata(agentIds: string[]): AgentMetadataMap {
  const [metadata, setMetadata] = useState<AgentMetadataMap>(() =>
    buildInitial(agentIds)
  );

  useEffect(() => {
    if (agentIds.length === 0) return;

    // For any agentId not yet cached, kick off a fetch
    const missing = agentIds.filter((id) => !cache.has(id));
    if (missing.length === 0) {
      // Everything is already cached — build final state synchronously
      setMetadata(buildFromCache(agentIds));
      return;
    }

    let cancelled = false;

    Promise.all(agentIds.map(fetchAndParse)).then((results) => {
      if (cancelled) return;
      const map: AgentMetadataMap = {};
      agentIds.forEach((id, idx) => {
        map[id] = { ...results[idx], loading: false };
      });
      setMetadata(map);
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentIds.join(',')]);

  return metadata;
}

function buildInitial(agentIds: string[]): AgentMetadataMap {
  const map: AgentMetadataMap = {};
  for (const id of agentIds) {
    if (cache.has(id)) {
      map[id] = { ...cache.get(id)!, loading: false };
    } else {
      map[id] = { skills: [], loading: true };
    }
  }
  return map;
}

function buildFromCache(agentIds: string[]): AgentMetadataMap {
  const map: AgentMetadataMap = {};
  for (const id of agentIds) {
    map[id] = { ...(cache.get(id) ?? { skills: [] }), loading: false };
  }
  return map;
}

/** Exported for testing: clear the module-level cache. */
export function _clearAgentMetadataCache() {
  cache.clear();
  inflight.clear();
}
