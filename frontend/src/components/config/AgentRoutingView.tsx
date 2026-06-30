/**
 * AgentRoutingView — the Proposal D "Agents & Routing" view.
 *
 * Layout:
 *   header: title + ScopeSelector + search bar
 *   body: scrollable list of AgentRoutingCard (one per pipeline stage)
 *   footer: Save (scope-labelled) + Reset — disabled unless dirty
 *
 * Local dirty state is tracked per scope so switching scopes doesn't lose
 * in-progress edits. Both scopes share a single "dirty" dirty guard via
 * onDirtyChange callback.
 *
 * Save routing:
 *   Global → saveSettings({ pipeline: { stageModels } })
 *   Space  → renameSpace(id, name, wd, pipeline, nicknames, stageModels)
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore }         from '@/stores/useAppStore';
import { AgentRoutingCard }    from './AgentRoutingCard';
import { ScopeSelector }       from './ScopeSelector';
import type { Scope }          from './ScopeSelector';
import { useAgentMetadata }    from '@/hooks/useAgentMetadata';
import { resolveEffectiveModel }  from '@/utils/modelRouting';
import { localModelsToStageModelsMap } from '@/utils/modelRouting';
import { STAGE_ROLES }         from '@/utils/agentName';
import { STAGE_DISPLAY }       from '@/utils/agentName';
import type { StageModelsMap } from '@/types';

interface AgentRoutingViewProps {
  /** Notify parent whether any local edits exist (for the discard guard). */
  onDirtyChange: (dirty: boolean) => void;
}

/** Convert a StageModelsMap (server) → local Record<agentId, model string>. */
function stageModelsToLocal(map: StageModelsMap | null | undefined): Record<string, string> {
  if (!map) return {};
  const result: Record<string, string> = {};
  for (const [id, cfg] of Object.entries(map)) {
    if (cfg?.model) result[id] = cfg.model;
  }
  return result;
}

export function AgentRoutingView({ onDirtyChange }: AgentRoutingViewProps) {
  const agentSettings  = useAppStore((s) => s.agentSettings);
  const saveSettings   = useAppStore((s) => s.saveSettings);
  const showToast      = useAppStore((s) => s.showToast);
  const spaces         = useAppStore((s) => s.spaces);
  const activeSpaceId  = useAppStore((s) => s.activeSpaceId);
  const renameSpace    = useAppStore((s) => s.renameSpace);

  const activeSpace = spaces.find((sp) => sp.id === activeSpaceId) ?? null;

  const stages = agentSettings?.pipeline?.stages ?? [];

  // ── Local edit state (one map per scope) ────────────────────────────────
  const [scope, setScope] = useState<Scope>('global');
  const [localGlobal, setLocalGlobal] = useState<Record<string, string>>({});
  const [localSpace,  setLocalSpace]  = useState<Record<string, string>>({});
  const [dirtyGlobal, setDirtyGlobal] = useState(false);
  const [dirtySpace,  setDirtySpace]  = useState(false);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [search,      setSearch]      = useState('');
  const [saving,      setSaving]      = useState(false);

  // ── Fetch agent metadata ─────────────────────────────────────────────────
  const metadata = useAgentMetadata(stages);

  // ── Sync from store when settings / space change ─────────────────────────
  useEffect(() => {
    setLocalGlobal(stageModelsToLocal(agentSettings?.pipeline?.stageModels));
    setDirtyGlobal(false);
  }, [agentSettings?.pipeline?.stageModels]);

  useEffect(() => {
    setLocalSpace(stageModelsToLocal(activeSpace?.stageModels));
    setDirtySpace(false);
  }, [activeSpace?.stageModels]);

  // ── Propagate dirty up ──────────────────────────────────────────────────
  useEffect(() => {
    onDirtyChange(dirtyGlobal || dirtySpace);
  }, [dirtyGlobal, dirtySpace, onDirtyChange]);

  // ── Scope-local helpers ──────────────────────────────────────────────────
  const localMap   = scope === 'global' ? localGlobal : localSpace;
  const setLocal   = scope === 'global' ? setLocalGlobal : setLocalSpace;
  const setDirty   = scope === 'global' ? setDirtyGlobal : setDirtySpace;
  const isDirty    = scope === 'global' ? dirtyGlobal : dirtySpace;

  const globalStageModels = (agentSettings?.pipeline?.stageModels ?? {}) as StageModelsMap;
  const spaceStageModels  = activeSpace?.stageModels ?? null;

  const handleChange = useCallback((agentId: string, model: string) => {
    setLocal((prev) => {
      const next = { ...prev };
      if (model.trim()) {
        next[agentId] = model.trim();
      } else {
        delete next[agentId];
      }
      return next;
    });
    setDirty(true);
  }, [setLocal, setDirty]);

  const handleClear = useCallback((agentId: string) => {
    setLocal((prev) => {
      const next = { ...prev };
      delete next[agentId];
      return next;
    });
    setDirty(true);
  }, [setLocal, setDirty]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const stageModels = localModelsToStageModelsMap(localMap);
      if (scope === 'global') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await saveSettings({ pipeline: { stageModels } } as any);
        showToast('Global model routing saved', 'success');
        setDirtyGlobal(false);
      } else if (activeSpace) {
        await renameSpace(
          activeSpace.id,
          activeSpace.name,
          activeSpace.workingDirectory,
          activeSpace.pipeline,
          activeSpace.agentNicknames,
          stageModels,
        );
        showToast('Space model routing saved', 'success');
        setDirtySpace(false);
      }
    } catch {
      showToast('Failed to save model routing', 'error');
    } finally {
      setSaving(false);
    }
  }, [localMap, scope, saveSettings, renameSpace, activeSpace, showToast]);

  const handleReset = useCallback(() => {
    if (scope === 'global') {
      setLocalGlobal(stageModelsToLocal(agentSettings?.pipeline?.stageModels));
      setDirtyGlobal(false);
    } else {
      setLocalSpace(stageModelsToLocal(activeSpace?.stageModels));
      setDirtySpace(false);
    }
  }, [scope, agentSettings?.pipeline?.stageModels, activeSpace?.stageModels]);

  // ── Search filter ────────────────────────────────────────────────────────
  const filteredStages = useMemo(() => {
    if (!search.trim()) return stages;
    const q = search.toLowerCase().trim();
    return stages.filter((agentId) => {
      const meta = metadata[agentId];
      const displayName  = STAGE_DISPLAY[agentId] ?? agentId;
      const roleSubtitle = STAGE_ROLES[agentId]   ?? '';
      const effective    = resolveEffectiveModel(agentId, scope, globalStageModels, spaceStageModels, meta?.model);
      const skillMatch   = meta?.skills.some((s) => s.toLowerCase().includes(q)) ?? false;
      return (
        agentId.toLowerCase().includes(q) ||
        displayName.toLowerCase().includes(q) ||
        roleSubtitle.toLowerCase().includes(q) ||
        effective.model.toLowerCase().includes(q) ||
        skillMatch
      );
    });
  }, [stages, search, metadata, scope, globalStageModels, spaceStageModels]);

  // ── Empty stages state ────────────────────────────────────────────────────
  if (stages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 py-12 px-6 text-center">
        <span className="material-symbols-outlined text-3xl text-text-secondary" aria-hidden="true">
          smart_toy
        </span>
        <p className="text-sm text-text-secondary">
          No pipeline stages configured.<br />
          Add agents to pipeline settings to see routing options here.
        </p>
      </div>
    );
  }

  const saveLabel = saving
    ? 'Saving…'
    : scope === 'global'
      ? 'Save · Global'
      : `Save · ${activeSpace?.name ?? 'Space'}`;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Subheader: scope + search ────────────────────────────────── */}
      <div className="px-4 pt-2 pb-1 border-b border-border shrink-0 flex flex-col gap-2">
        <ScopeSelector
          scope={scope}
          spaceName={activeSpace?.name}
          onChange={setScope}
        />
        {/* Search */}
        <div className="flex items-center gap-2 bg-surface border border-border rounded-[9px] px-3 py-2">
          <span className="material-symbols-outlined text-[17px] text-text-secondary leading-none shrink-0" aria-hidden="true">
            search
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agent, model or skill…"
            aria-label="Search agents"
            className={[
              'flex-1 bg-transparent border-0 outline-none',
              'text-[12.5px] text-text-primary placeholder:text-text-secondary/50',
            ].join(' ')}
          />
        </div>
      </div>

      {/* ── Card list ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto pb-2">
        {filteredStages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 px-6 text-center">
            <span className="material-symbols-outlined text-2xl text-text-secondary" aria-hidden="true">
              search_off
            </span>
            <p className="text-sm text-text-secondary">
              No agents match &ldquo;{search}&rdquo;
            </p>
          </div>
        ) : (
          filteredStages.map((agentId) => {
            const meta         = metadata[agentId] ?? { skills: [], loading: true };
            const displayName  = STAGE_DISPLAY[agentId] ?? agentId;
            const roleSubtitle = STAGE_ROLES[agentId]   ?? '';
            const effective    = resolveEffectiveModel(agentId, scope, globalStageModels, spaceStageModels, meta.model);
            const localModel   = localMap[agentId] ?? '';
            const hasOverride  = !!localMap[agentId];

            return (
              <AgentRoutingCard
                key={agentId}
                agentId={agentId}
                displayName={displayName}
                roleSubtitle={roleSubtitle}
                effectiveModel={effective.model}
                source={localModel ? scope as typeof effective.source : effective.source}
                localModel={localModel}
                metadata={meta}
                open={expandedId === agentId}
                onToggle={() => setExpandedId((prev) => (prev === agentId ? null : agentId))}
                onChange={handleChange}
                onClear={handleClear}
                hasOverride={hasOverride}
              />
            );
          })
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-t border-border shrink-0 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleReset}
          disabled={saving}
          className={[
            'text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-colors duration-fast',
            'text-text-secondary hover:text-text-primary hover:bg-surface-variant',
            saving ? 'opacity-50 cursor-not-allowed' : '',
          ].join(' ')}
        >
          Reset
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !isDirty}
          aria-busy={saving}
          className={[
            'text-[12.5px] font-semibold px-4 py-1.5 rounded-lg transition-all duration-fast',
            isDirty && !saving
              ? 'bg-primary text-white hover:bg-primary-hover'
              : 'bg-primary/30 text-primary/50 cursor-not-allowed',
          ].join(' ')}
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
}
