/**
 * AgentRoutingCard — one card per pipeline agent in the Proposal D view.
 *
 * Collapsed: dot, name, role subtitle, mini model pill (tinted when overridden),
 *            skill count, chevron.
 * Expanded:  Model picker (badge + presets + custom input + Clear), read-only
 *            EffortSegmented, read-only SkillsReadOnly.
 *
 * Model edits are lifted up via callbacks; the card itself is stateless w.r.t.
 * model selection.
 */

import React, { useId } from 'react';
import { SOURCE_CLASSES, SOURCE_MUTED_CLASSES } from './ModelInheritanceBadge';
import { EffortSegmented }       from './EffortSegmented';
import { SkillsReadOnly }        from './SkillsReadOnly';
import { CliToolSelector }       from './CliToolSelector';
import { agentDotColor }         from '@/utils/agentName';
import { isValidOpencodeModel }  from '@/utils/modelRouting';
import type { ModelSource }      from '@/utils/modelRouting';
import type { Scope }            from './ScopeSelector';
import type { ModelCliTool }     from '@/types';
import type { AgentMetadataEntry } from '@/hooks/useAgentMetadata';

const CLAUDE_PRESETS = ['claude-opus-4-8', 'claude-sonnet-5', 'claude-opus-4-7'] as const;
const OPENCODE_HINT = 'provider/model';

interface AgentRoutingCardProps {
  agentId:      string;
  displayName:  string;
  /** Effective model (resolved for the current scope). */
  effectiveModel: string;
  /** Source of the effective model — drives the badge and mini-pill tint. */
  source: ModelSource;
  /** The scope currently being edited — a row is "overridden here" when source === scope. */
  scope: Scope;
  /** Local override model string for the current scope (empty string = no local edit). */
  localModel: string;
  /** True when there's a local edit that hasn't been persisted (saved) yet. */
  unsaved?: boolean;
  /** Parsed frontmatter metadata. */
  metadata: AgentMetadataEntry;
  /** Whether the card is expanded. */
  open: boolean;
  /** Toggle expand/collapse. */
  onToggle: () => void;
  /** Called when the user selects a model (preset or custom). */
  onChange: (agentId: string, model: string) => void;
  /** Called when the user clears the override. Only visible when source !== 'default'. */
  onClear: (agentId: string) => void;
  /** Whether the Clear button should be shown (override exists at current scope). */
  hasOverride: boolean;
  /** Effective CLI tool for this agent at the current scope. */
  cliTool: ModelCliTool;
  /** Called when the user switches the CLI tool (claude ⇄ opencode). */
  onChangeCliTool: (agentId: string, cliTool: ModelCliTool) => void;
  /** Called when the user wants to view/edit the agent's system prompt (.md). */
  onEditPrompt?: (agentId: string) => void;
}

export function AgentRoutingCard({
  agentId,
  displayName,
  effectiveModel,
  source,
  scope,
  localModel,
  unsaved = false,
  metadata,
  open,
  onToggle,
  onChange,
  onClear,
  hasOverride,
  cliTool,
  onChangeCliTool,
  onEditPrompt,
}: AgentRoutingCardProps) {
  const detailId  = useId();
  const dotClass  = agentDotColor(agentId);

  /** Model shown in the mini-pill and in the preset/input area. */
  const displayModel = localModel || effectiveModel;
  const isOpencode   = cliTool === 'opencode';
  const isPreset     = !isOpencode && CLAUDE_PRESETS.includes(displayModel as typeof CLAUDE_PRESETS[number]);
  /** True when the model is overridden at the scope being edited (the actionable deviation). */
  const isScopeOverride = source === scope;
  /** True when the value is inherited from a higher scope (e.g. Global while viewing Space) —
   *  distinct from both "overridden here" and "default" (agent's own frontmatter). */
  const isInherited = !isScopeOverride && source !== 'default';
  /** opencode requires a `provider/model` string — flag an invalid local edit. */
  const opencodeInvalid = isOpencode && !!displayModel && !isValidOpencodeModel(displayModel);
  /** opencode selected but no valid provider/model yet → show an example, not the inherited Claude model. */
  const needsOpencodeModel = isOpencode && !isValidOpencodeModel(displayModel);

  return (
    <article
      className={[
        'border rounded-md mx-4 my-2.5 overflow-hidden',
        'transition-colors duration-fast',
        open ? 'border-primary' : 'border-border',
      ].join(' ')}
      data-testid={`agent-card-${agentId}`}
    >
      {/* ── Collapsed / header row ─────────────────────────────────────── */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={detailId}
        className={[
          'w-full flex items-center gap-2.5 px-4 py-3 text-left',
          'transition-colors duration-fast',
          open ? 'bg-surface-variant/30' : 'hover:bg-surface-variant',
        ].join(' ')}
      >
        {/* Agent color dot */}
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotClass}`}
          aria-hidden="true"
        />

        {/* Name — min-w floor so the CLI tag/model pill/badge siblings can never
            squeeze it to zero width; title recovers the full name when truncated.
            Sans/medium (not mono) — this is a human label, not a technical string. */}
        <span className="min-w-[64px] flex-1">
          <span
            className="text-[13px] font-sans font-medium text-text-primary leading-snug truncate block"
            title={displayName}
          >
            {displayName}
          </span>
        </span>

        {/* Unsaved-edit indicator — the pill/badge already reflect the pending value, this
            just makes clear it hasn't been persisted yet (distinct from an already-saved override) */}
        {!open && unsaved && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-primary shrink-0"
            title="Unsaved change — click Save to persist it"
            aria-label="Unsaved change"
          />
        )}

        {/* CLI-tool tag — surfaces the non-default CLI (opencode) in the collapsed row */}
        {!open && isOpencode && (
          <span
            className="inline-flex items-center font-mono text-[11px] px-2 py-0.5 rounded-md bg-surface-variant text-text-secondary border border-border/60 whitespace-nowrap"
            title="Runs via the opencode CLI"
          >
            opencode
          </span>
        )}

        {/* Mini model pill — tinted + labelled with the source when overridden at the current
            scope (one capsule, not two); dashed border (no label) when the value is inherited
            from a higher scope, so it never claims to be "set here"; placeholder when opencode
            lacks a model. */}
        {!open && (
          <span
            className={[
              'inline-flex items-center gap-1 min-w-0 shrink max-w-[110px] font-mono text-[11px] px-2 py-0.5 rounded-md border',
              needsOpencodeModel
                ? 'text-text-secondary/50 border-border border-dashed bg-transparent'
                : isScopeOverride
                  ? SOURCE_CLASSES[source]
                  : isInherited
                    ? SOURCE_MUTED_CLASSES[source]
                    : 'text-text-secondary border-border bg-surface',
            ].join(' ')}
            title={
              needsOpencodeModel
                ? 'No opencode model set yet — example shown'
                : isInherited
                  ? `Inherited from ${source} settings — not set at this scope`
                  : (displayModel ?? undefined)
            }
          >
            {isScopeOverride && (
              <span className="font-sans font-semibold uppercase tracking-wide text-[11px] opacity-80 shrink-0">
                {source}
              </span>
            )}
            <span className="truncate min-w-0">
              {needsOpencodeModel ? OPENCODE_HINT : (displayModel || '—')}
            </span>
          </span>
        )}

        {/* Skill count — demoted (tertiary, no icon): secondary info, doesn't compete with the model pill */}
        {!open && (
          <span
            className="text-[11px] text-text-tertiary shrink-0 w-5 text-right tabular-nums"
            title={metadata.loading ? undefined : `${metadata.skills.length} skill${metadata.skills.length === 1 ? '' : 's'}`}
          >
            {metadata.loading ? '…' : metadata.skills.length}
          </span>
        )}

        {/* Chevron — single glyph, rotates instead of swapping icons, so open/close reads as one continuous motion */}
        <span
          className={[
            'material-symbols-outlined text-lg text-text-secondary leading-none shrink-0 ml-auto',
            'transition-transform duration-fast motion-safe:transition-transform',
            open ? 'rotate-90' : '',
          ].join(' ')}
          aria-hidden="true"
        >
          chevron_right
        </span>
      </button>

      {/* ── Expanded detail ────────────────────────────────────────────── */}
      {open && (
        <div
          id={detailId}
          className="bg-surface px-4 pt-1 pb-5 flex flex-col gap-0 motion-safe:animate-fade-in-up"
        >
          {/* Model + Effort row */}
          <div className="flex flex-col md:flex-row items-start gap-6 md:gap-10 py-5 border-b border-border/50">
            {/* Model section */}
            <div className="flex flex-col gap-3 min-w-0 flex-1">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary">
                Model
              </label>
              {/* CLI tool: Claude (managed) vs opencode (local/self-hosted via MODEL-2) */}
              <CliToolSelector
                value={cliTool}
                onChange={(next) => onChangeCliTool(agentId, next)}
                agentLabel={displayName}
              />
              {/* Current model — one pill, not badge + pill: the source label lives inside it
                  so there's a single colour to keep in sync, not two elements that can drift. */}
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={[
                    'inline-flex items-center gap-1.5 font-mono text-[12px] px-2.5 py-1 rounded-lg border',
                    needsOpencodeModel
                      ? 'text-text-secondary/50 border-border border-dashed bg-transparent'
                      : isScopeOverride
                        ? SOURCE_CLASSES[source]
                        : isInherited
                          ? SOURCE_MUTED_CLASSES[source]
                          : SOURCE_MUTED_CLASSES.default,
                  ].join(' ')}
                  title={needsOpencodeModel
                    ? 'No opencode model set yet — example shown; set it in the field below'
                    : 'Current model — change it with the presets or the input below'}
                >
                  {!needsOpencodeModel && (
                    <span className="font-sans font-semibold uppercase tracking-wide text-[11px] opacity-80">
                      {isScopeOverride ? source : isInherited ? 'inherited' : 'default'}
                    </span>
                  )}
                  {needsOpencodeModel ? OPENCODE_HINT : (displayModel || <span className="text-text-secondary">—</span>)}
                </span>
                {hasOverride && (
                  <button
                    type="button"
                    onClick={() => onClear(agentId)}
                    aria-label={`Clear model override for ${displayName}`}
                    className="text-text-secondary hover:text-error hover:bg-surface-variant text-[12px] rounded px-1.5 py-0.5 transition-colors duration-fast focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Microcopy — names where the value actually comes from and what clicking a preset does */}
              {isInherited && (
                <p className="text-[11px] leading-tight text-text-secondary/70">
                  Inherited from {source} — pick a preset below to override it for this scope.
                </p>
              )}

              {/* Preset chips — Claude only (opencode models are open-ended) */}
              {!isOpencode && (
                <div
                  className="flex flex-wrap gap-2"
                  role="radiogroup"
                  aria-label={`Model presets for ${displayName}`}
                >
                  {CLAUDE_PRESETS.map((preset) => {
                    const short     = preset.replace('claude-', '');
                    const selected  = displayModel === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onChange(agentId, preset)}
                        className={[
                          'px-2.5 py-1 text-[12px] font-mono rounded-lg border',
                          'transition-all duration-fast active:scale-[0.97]',
                          'focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50',
                          selected
                            ? 'bg-primary text-white border-primary'
                            : 'bg-surface border-border text-text-secondary hover:border-primary/50 hover:text-text-primary',
                        ].join(' ')}
                      >
                        {short}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Custom / opencode model input */}
              <input
                type="text"
                aria-label={isOpencode ? `opencode model for ${displayName}` : `Custom model for ${displayName}`}
                aria-invalid={opencodeInvalid}
                placeholder={
                  isOpencode
                    ? OPENCODE_HINT
                    : (isPreset ? 'Custom model string…' : (displayModel || 'Custom model string…'))
                }
                value={isOpencode ? (localModel || '') : (!isPreset ? (localModel || '') : '')}
                onChange={(e) => onChange(agentId, e.target.value)}
                className={[
                  'w-full bg-surface border rounded-lg px-3 py-1.5',
                  'text-[12px] text-text-primary placeholder:text-text-secondary/50',
                  'focus:outline-none focus:ring-1 transition-all duration-fast font-mono',
                  opencodeInvalid
                    ? 'border-error focus:ring-error/50 focus:border-error'
                    : 'border-border focus:ring-primary/50 focus:border-primary',
                ].join(' ')}
              />

              {/* opencode format helper / inline validation */}
              {isOpencode && (
                <p className={[
                  'text-[11px] leading-tight',
                  opencodeInvalid ? 'text-error' : 'text-text-secondary/70',
                ].join(' ')}>
                  {opencodeInvalid
                    ? 'opencode needs a provider/model string (must contain “/”).'
                    : 'Runs via the opencode CLI — use a provider/model string from your opencode config.'}
                </p>
              )}
            </div>

            {/* Effort section */}
            <div className="flex flex-col gap-3 shrink-0">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary">
                Effort
              </label>
              <EffortSegmented value={metadata.effort} loading={metadata.loading} />
            </div>
          </div>

          {/* Skills section */}
          <div className="pt-5">
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
              Skills
            </label>
            <SkillsReadOnly skills={metadata.skills} loading={metadata.loading} />
          </div>

          {/* System prompt — opens the agent's .md in the editor */}
          {onEditPrompt && (
            <div className="pt-5">
              <label className="block text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
                System prompt
              </label>
              <button
                type="button"
                onClick={() => onEditPrompt(agentId)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-surface text-[12px] text-text-primary hover:border-primary/50 hover:text-primary transition-all duration-fast active:scale-[0.97]"
              >
                <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">
                  description
                </span>
                View / edit .md
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
