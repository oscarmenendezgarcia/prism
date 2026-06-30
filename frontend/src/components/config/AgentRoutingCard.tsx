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
import { ModelInheritanceBadge } from './ModelInheritanceBadge';
import { EffortSegmented }       from './EffortSegmented';
import { SkillsReadOnly }        from './SkillsReadOnly';
import type { ModelSource }      from '@/utils/modelRouting';
import type { AgentMetadataEntry } from '@/hooks/useAgentMetadata';

const CLAUDE_PRESETS = ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'] as const;

/** Dot color class per agent ID. */
const AGENT_DOT: Record<string, string> = {
  'senior-architect': 'bg-agent-architect',
  'ux-api-designer':  'bg-agent-ux',
  'developer-agent':  'bg-agent-dev',
  'code-reviewer':    'bg-agent-reviewer',
  'qa-engineer-e2e':  'bg-agent-qa',
};

interface AgentRoutingCardProps {
  agentId:      string;
  displayName:  string;
  roleSubtitle: string;
  /** Effective model (resolved for the current scope). */
  effectiveModel: string;
  /** Source of the effective model — drives the badge and mini-pill tint. */
  source: ModelSource;
  /** Local override model string for the current scope (empty string = no local edit). */
  localModel: string;
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
}

export function AgentRoutingCard({
  agentId,
  displayName,
  roleSubtitle,
  effectiveModel,
  source,
  localModel,
  metadata,
  open,
  onToggle,
  onChange,
  onClear,
  hasOverride,
}: AgentRoutingCardProps) {
  const detailId  = useId();
  const dotClass  = AGENT_DOT[agentId] ?? 'bg-primary';

  /** Model shown in the mini-pill and in the preset/input area. */
  const displayModel = localModel || effectiveModel;
  const isPreset     = CLAUDE_PRESETS.includes(displayModel as typeof CLAUDE_PRESETS[number]);
  const isOverridden = source !== 'default';

  return (
    <article
      className={[
        'border rounded-[11px] mx-4 my-2 overflow-hidden',
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
          'w-full flex items-center gap-2.5 px-3.5 py-3 text-left',
          'transition-colors duration-fast',
          open ? 'bg-surface-variant/30' : 'hover:bg-surface-variant',
        ].join(' ')}
      >
        {/* Agent color dot */}
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotClass}`}
          aria-hidden="true"
        />

        {/* Name + role */}
        <span className="flex flex-col gap-0 min-w-0 flex-1">
          <span className="text-[13px] font-medium text-text-primary leading-snug font-mono truncate">
            {displayName}
          </span>
          <span className="text-[11px] text-text-secondary leading-tight truncate">
            {roleSubtitle}
          </span>
        </span>

        {/* Mini model pill — tinted when source ≠ default */}
        {!open && (
          <span
            className={[
              'font-mono text-[10.5px] px-2 py-0.5 rounded-md border whitespace-nowrap',
              isOverridden
                ? 'text-primary border-primary bg-primary-container'
                : 'text-text-secondary border-border bg-surface',
            ].join(' ')}
          >
            {displayModel || '—'}
          </span>
        )}

        {/* Skill count */}
        {!open && (
          <span className="flex items-center gap-0.5 text-[11px] text-text-secondary shrink-0">
            <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">
              extension
            </span>
            {metadata.loading ? '…' : metadata.skills.length}
          </span>
        )}

        {/* Chevron */}
        <span className="material-symbols-outlined text-lg text-text-secondary leading-none shrink-0 ml-auto" aria-hidden="true">
          {open ? 'expand_more' : 'chevron_right'}
        </span>
      </button>

      {/* ── Expanded detail ────────────────────────────────────────────── */}
      {open && (
        <div
          id={detailId}
          className="bg-surface px-3.5 pb-3.5 flex flex-col gap-0"
        >
          {/* Model + Effort row */}
          <div className="flex items-start gap-6 py-3 border-b border-border/50">
            {/* Model section */}
            <div className="flex flex-col gap-2 min-w-0">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary">
                Model
              </label>
              {/* Badge + current model pill */}
              <div className="flex items-center gap-2 flex-wrap">
                <ModelInheritanceBadge source={source} />
                <span className={[
                  'font-mono text-[11.5px] px-2.5 py-1 rounded-lg border',
                  'flex items-center gap-1.5',
                  isOverridden
                    ? 'text-primary border-primary bg-primary-container'
                    : 'text-text-primary border-border bg-surface',
                ].join(' ')}>
                  {displayModel || <span className="text-text-secondary">—</span>}
                  <span className="material-symbols-outlined text-[15px] text-text-secondary leading-none" aria-hidden="true">
                    expand_more
                  </span>
                </span>
                {hasOverride && (
                  <button
                    type="button"
                    onClick={() => onClear(agentId)}
                    aria-label={`Clear model override for ${displayName}`}
                    className="text-text-secondary hover:text-error text-[12px] transition-colors duration-fast"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Preset chips */}
              <div
                className="flex flex-wrap gap-1.5 mt-1"
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
                        'px-2.5 py-1 text-[11px] font-mono rounded-full border',
                        'transition-all duration-fast',
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

              {/* Custom input */}
              <input
                type="text"
                aria-label={`Custom model for ${displayName}`}
                placeholder={isPreset ? 'Custom model string…' : (displayModel || 'Custom model string…')}
                value={!isPreset ? (localModel || '') : ''}
                onChange={(e) => onChange(agentId, e.target.value)}
                className={[
                  'w-full bg-surface border border-border rounded-lg px-3 py-1.5',
                  'text-[12px] text-text-primary placeholder:text-text-secondary/50',
                  'focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary',
                  'transition-all duration-fast font-mono',
                ].join(' ')}
              />
            </div>

            {/* Effort section */}
            <div className="flex flex-col gap-2 shrink-0">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary">
                Effort
              </label>
              <EffortSegmented value={metadata.effort} />
            </div>
          </div>

          {/* Skills section */}
          <div className="pt-3">
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-2">
              Skills
            </label>
            <SkillsReadOnly skills={metadata.skills} loading={metadata.loading} />
          </div>
        </div>
      )}
    </article>
  );
}
