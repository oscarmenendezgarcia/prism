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
import { localRoutingToStageModelsMap, isValidOpencodeModel } from '@/utils/modelRouting';
import type { RoutingEntry }    from '@/utils/modelRouting';
import { STAGE_DISPLAY }       from '@/utils/agentName';
import type { StageModelsMap, ModelCliTool } from '@/types';

interface AgentRoutingViewProps {
  /** Notify parent whether any local edits exist (for the discard guard). */
  onDirtyChange: (dirty: boolean) => void;
  /** Open the agent's system prompt (.md) in the editor. */
  onEditPrompt?: (agentId: string) => void;
}

/** Convert a StageModelsMap (server) → local Record<agentId, {model, cliTool}>. */
function stageModelsToLocal(map: StageModelsMap | null | undefined): Record<string, RoutingEntry> {
  if (!map) return {};
  const result: Record<string, RoutingEntry> = {};
  for (const [id, cfg] of Object.entries(map)) {
    if (cfg?.model) result[id] = { model: cfg.model, cliTool: cfg.cliTool ?? 'claude' };
  }
  return result;
}

export function AgentRoutingView({ onDirtyChange, onEditPrompt }: AgentRoutingViewProps) {
  const agentSettings  = useAppStore((s) => s.agentSettings);
  const saveSettings   = useAppStore((s) => s.saveSettings);
  const showToast      = useAppStore((s) => s.showToast);
  const spaces         = useAppStore((s) => s.spaces);
  const activeSpaceId  = useAppStore((s) => s.activeSpaceId);
  const renameSpace    = useAppStore((s) => s.renameSpace);

  const availableAgents = useAppStore((s) => s.availableAgents);
  const loadAgents       = useAppStore((s) => s.loadAgents);

  const activeSpace = spaces.find((sp) => sp.id === activeSpaceId) ?? null;

  const stages = agentSettings?.pipeline?.stages ?? [];

  // Routing applies to ANY agent, not just pipeline stages — show the union:
  // pipeline stages first (in order), then every other available agent.
  const agentIds = useMemo(() => {
    const inPipeline = new Set<string>(stages);
    const extra = availableAgents.map((a) => a.id).filter((id) => !inPipeline.has(id));
    return [...stages, ...extra];
  }, [stages, availableAgents]);

  // Human-readable names for non-pipeline agents come from the agent registry.
  const agentDisplay = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of availableAgents) m[a.id] = a.displayName;
    return m;
  }, [availableAgents]);

  // Registry (the agent's own .md) is the source of truth; STAGE_DISPLAY is only a
  // fallback for the well-known pipeline agents when the registry hasn't loaded yet.
  const displayNameFor = useCallback(
    (id: string) => agentDisplay[id] ?? STAGE_DISPLAY[id] ?? id,
    [agentDisplay],
  );

  // ── Local edit state (one map per scope) ────────────────────────────────
  const [scope, setScope] = useState<Scope>('global');
  const [localGlobal, setLocalGlobal] = useState<Record<string, RoutingEntry>>({});
  const [localSpace,  setLocalSpace]  = useState<Record<string, RoutingEntry>>({});
  const [dirtyGlobal, setDirtyGlobal] = useState(false);
  const [dirtySpace,  setDirtySpace]  = useState(false);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [search,      setSearch]      = useState('');
  const [saving,      setSaving]      = useState(false);

  // ── Ensure the full agent registry is loaded (panel doesn't load it) ──────
  useEffect(() => {
    if (availableAgents.length === 0) loadAgents(activeSpace?.workingDirectory);
  }, [availableAgents.length, loadAgents, activeSpace?.workingDirectory]);

  // ── Fetch agent metadata (model/effort/skills) for every agent ────────────
  const metadata = useAgentMetadata(agentIds);

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
      const cliTool = prev[agentId]?.cliTool ?? 'claude';
      if (model.trim()) {
        next[agentId] = { model: model.trim(), cliTool };
      } else if (cliTool === 'claude') {
        // claude + empty model = clear the override entirely
        delete next[agentId];
      } else {
        // keep a non-claude CLI selection even with an empty model (mid-edit)
        next[agentId] = { model: '', cliTool };
      }
      return next;
    });
    setDirty(true);
  }, [setLocal, setDirty]);

  const handleChangeCliTool = useCallback((agentId: string, cliTool: ModelCliTool) => {
    setLocal((prev) => {
      const next = { ...prev };
      const prevModel = prev[agentId]?.model ?? '';
      // Drop a Claude model when switching to opencode (it can't be a provider/model string).
      const model = (cliTool === 'opencode' && !isValidOpencodeModel(prevModel)) ? '' : prevModel;
      if (cliTool === 'claude' && !model) {
        delete next[agentId];
      } else {
        next[agentId] = { model, cliTool };
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
    // Guard: opencode overrides must carry a provider/model string.
    const badOpencode = Object.entries(localMap).find(
      ([, e]) => e.cliTool === 'opencode' && e.model.trim() !== '' && !isValidOpencodeModel(e.model),
    );
    if (badOpencode) {
      showToast(`opencode model for "${badOpencode[0]}" must be in provider/model format`, 'error');
      return;
    }

    setSaving(true);
    try {
      const stageModels = localRoutingToStageModelsMap(localMap);
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
  const filteredAgents = useMemo(() => {
    if (!search.trim()) return agentIds;
    const q = search.toLowerCase().trim();
    return agentIds.filter((agentId) => {
      const meta = metadata[agentId];
      const displayName  = displayNameFor(agentId);
      const effective    = resolveEffectiveModel(agentId, scope, globalStageModels, spaceStageModels, meta?.model);
      const skillMatch   = meta?.skills.some((s) => s.toLowerCase().includes(q)) ?? false;
      return (
        agentId.toLowerCase().includes(q) ||
        displayName.toLowerCase().includes(q) ||
        effective.model.toLowerCase().includes(q) ||
        skillMatch
      );
    });
  }, [agentIds, search, metadata, scope, globalStageModels, spaceStageModels, displayNameFor]);

  // ── Empty state (no agents at all) ────────────────────────────────────────
  if (agentIds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 py-12 px-6 text-center">
        <span className="material-symbols-outlined text-3xl text-text-secondary" aria-hidden="true">
          smart_toy
        </span>
        <p className="text-sm text-text-secondary">
          No agents found.<br />
          Add agent definitions to ~/.claude/agents to configure routing.
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
        <div className="flex items-center gap-2 bg-surface border border-border rounded-sm px-3 py-2 focus-within:ring-1 focus-within:ring-primary focus-within:border-primary">
          <span className="material-symbols-outlined text-[17px] text-text-secondary leading-none shrink-0" aria-hidden="true">
            search
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agent, model or skill…"
            aria-label="Search agents"
            className={[
              'flex-1 bg-transparent border-0 outline-none',
              'text-[12.5px] text-text-primary placeholder:text-text-secondary/70',
            ].join(' ')}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="text-text-secondary hover:text-text-primary transition-colors duration-fast shrink-0"
            >
              <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">
                close
              </span>
            </button>
          )}
        </div>
      </div>

      {/* ── Card list ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto pb-2">
        {filteredAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 px-6 text-center">
            <span className="material-symbols-outlined text-2xl text-text-secondary" aria-hidden="true">
              search_off
            </span>
            <p className="text-sm text-text-secondary">
              No agents match &ldquo;{search}&rdquo;
            </p>
            <p className="text-[11px] text-text-secondary/70">
              Try searching by agent name, model, or skill
            </p>
            <button
              type="button"
              onClick={() => setSearch('')}
              className={[
                'mt-1 text-[12px] font-medium text-primary',
                'hover:underline transition-colors duration-fast',
              ].join(' ')}
            >
              Clear search
            </button>
          </div>
        ) : (
          filteredAgents.map((agentId) => {
            const meta         = metadata[agentId] ?? { skills: [], loading: true };
            const displayName  = displayNameFor(agentId);
            const effective    = resolveEffectiveModel(agentId, scope, globalStageModels, spaceStageModels, meta.model);
            const localEntry   = localMap[agentId];
            const localModel   = localEntry?.model ?? '';
            const hasOverride  = !!localEntry;
            // Effective CLI tool: local edit → saved override (scope-resolved) → claude.
            const serverEntry  = scope === 'space'
              ? (spaceStageModels?.[agentId] ?? globalStageModels[agentId])
              : globalStageModels[agentId];
            const cliTool      = localEntry?.cliTool ?? serverEntry?.cliTool ?? 'claude';

            return (
              <AgentRoutingCard
                key={agentId}
                agentId={agentId}
                displayName={displayName}
                effectiveModel={effective.model}
                source={localModel ? scope as typeof effective.source : effective.source}
                scope={scope}
                localModel={localModel}
                metadata={meta}
                open={expandedId === agentId}
                onToggle={() => setExpandedId((prev) => (prev === agentId ? null : agentId))}
                onChange={handleChange}
                onClear={handleClear}
                hasOverride={hasOverride}
                cliTool={cliTool}
                onChangeCliTool={handleChangeCliTool}
                onEditPrompt={onEditPrompt}
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
