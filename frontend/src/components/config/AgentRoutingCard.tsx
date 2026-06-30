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
import { CliToolSelector }       from './CliToolSelector';
import { isValidOpencodeModel }  from '@/utils/modelRouting';
import type { ModelSource }      from '@/utils/modelRouting';
import type { ModelCliTool }     from '@/types';
import type { AgentMetadataEntry } from '@/hooks/useAgentMetadata';

const CLAUDE_PRESETS = ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'] as const;
const OPENCODE_EXAMPLE = 'vllm-local/qwen2.5-coder';
const OPENCODE_PLACEHOLDER = `provider/model  e.g. ${OPENCODE_EXAMPLE}`;

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
  /** Effective CLI tool for this agent at the current scope. */
  cliTool: ModelCliTool;
  /** Called when the user switches the CLI tool (claude ⇄ opencode). */
  onChangeCliTool: (agentId: string, cliTool: ModelCliTool) => void;
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
  cliTool,
  onChangeCliTool,
}: AgentRoutingCardProps) {
  const detailId  = useId();
  const dotClass  = AGENT_DOT[agentId] ?? 'bg-primary';

  /** Model shown in the mini-pill and in the preset/input area. */
  const displayModel = localModel || effectiveModel;
  const isOpencode   = cliTool === 'opencode';
  const isPreset     = !isOpencode && CLAUDE_PRESETS.includes(displayModel as typeof CLAUDE_PRESETS[number]);
  const isOverridden = source !== 'default';
  /** opencode requires a `provider/model` string — flag an invalid local edit. */
  const opencodeInvalid = isOpencode && !!displayModel && !isValidOpencodeModel(displayModel);
  /** opencode selected but no valid provider/model yet → show an example, not the inherited Claude model. */
  const needsOpencodeModel = isOpencode && !isValidOpencodeModel(displayModel);

  return (
    <article
      className={[
        'border rounded-[11px] mx-4 my-2.5 overflow-hidden',
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

        {/* Name + role */}
        <span className="flex flex-col gap-0 min-w-0 flex-1">
          <span className="text-[13px] font-medium text-text-primary leading-snug font-mono truncate">
            {displayName}
          </span>
          <span className="text-[11px] text-text-secondary leading-tight truncate">
            {roleSubtitle}
          </span>
        </span>

        {/* CLI-tool tag — surfaces the non-default CLI (opencode) in the collapsed row */}
        {!open && isOpencode && (
          <span
            className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface-variant text-text-secondary border border-border/60 whitespace-nowrap"
            title="Runs via the opencode CLI"
          >
            <span className="material-symbols-outlined text-[12px] leading-none" aria-hidden="true">terminal</span>
            opencode
          </span>
        )}

        {/* Mini model pill — tinted when source ≠ default; placeholder example when opencode lacks a model */}
        {!open && (
          <span
            className={[
              'font-mono text-[10.5px] px-2 py-0.5 rounded-md border whitespace-nowrap',
              needsOpencodeModel
                ? 'text-text-secondary/50 border-border border-dashed bg-transparent'
                : isOverridden
                  ? 'text-primary border-primary bg-primary-container'
                  : 'text-text-secondary border-border bg-surface',
            ].join(' ')}
            title={needsOpencodeModel ? 'No opencode model set yet — example shown' : undefined}
          >
            {needsOpencodeModel ? OPENCODE_EXAMPLE : (displayModel || '—')}
          </span>
        )}

        {/* Inheritance badge — visible in collapsed row so source is always at a glance */}
        {!open && <ModelInheritanceBadge source={source} />}

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
          className="bg-surface px-4 pt-1 pb-5 flex flex-col gap-0"
        >
          {/* Model + Effort row */}
          <div className="flex items-start gap-10 py-5 border-b border-border/50">
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
              {/* Badge + current model (read-only display of the effective value) */}
              <div className="flex items-center gap-2 flex-wrap">
                <ModelInheritanceBadge source={source} />
                <span
                  className={[
                    'font-mono text-[11.5px] px-2.5 py-1 rounded-lg border',
                    needsOpencodeModel
                      ? 'text-text-secondary/50 border-border border-dashed bg-transparent'
                      : isOverridden
                        ? 'text-primary border-primary bg-primary-container'
                        : 'text-text-primary border-border bg-surface',
                  ].join(' ')}
                  title={needsOpencodeModel
                    ? 'No opencode model set yet — example shown; set it in the field below'
                    : 'Current model — change it with the presets or the input below'}
                >
                  {needsOpencodeModel ? OPENCODE_EXAMPLE : (displayModel || <span className="text-text-secondary">—</span>)}
                </span>
                {hasOverride && (
                  <button
                    type="button"
                    onClick={() => onClear(agentId)}
                    aria-label={`Clear model override for ${displayName}`}
                    className="text-text-secondary hover:text-error text-[12px] transition-colors duration-fast ml-auto"
                  >
                    Clear
                  </button>
                )}
              </div>

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
                          'px-2.5 py-1 text-[11.5px] font-mono rounded-lg border',
                          'transition-all duration-fast active:scale-[0.97]',
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
                    ? OPENCODE_PLACEHOLDER
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
                  'text-[10.5px] leading-tight',
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
              <EffortSegmented value={metadata.effort} />
            </div>
          </div>

          {/* Skills section */}
          <div className="pt-5">
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
              Skills
            </label>
            <SkillsReadOnly skills={metadata.skills} loading={metadata.loading} />
          </div>
        </div>
      )}
    </article>
  );
}
