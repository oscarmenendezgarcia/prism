/**
 * Space settings: what happens when an agent finishes a task, as an ordered list of
 * hooks. Saved with the rest of the space by the modal's Save button.
 */

import React, { useState } from 'react';
import { Button } from '@/components/shared/Button';
import type { AgentChoice, SpaceHook } from '@/types';
import { HarnessIcon, HARNESS_NAMES, type DirectCliTool } from './HarnessIcon';

const inputClass = 'w-full px-3 py-2 rounded-lg bg-surface-variant border border-border text-sm text-text-primary placeholder:text-text-disabled focus:outline-hidden focus:border-primary transition-colors duration-fast';
const labelClass = 'flex flex-col gap-1 text-xs text-text-secondary';

const HOOK_TYPES: Array<{ value: NonNullable<SpaceHook['type']>; label: string }> = [
  { value: 'command', label: 'Runs a command' },
  { value: 'agent', label: 'An agent reviews it' },
  { value: 'pr', label: 'Opens a PR' },
];

const ON_FAIL_LABELS = {
  stop:  'Stop and tell me',
  retry: 'Ask the agent to fix it',
};

const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku'];
const TIMEOUT_MINUTES = [10, 30, 60];
const DEFAULT_TIMEOUT_MINUTES = 30;
const DEFAULT_RETRIES = 2;

function emptyDraft(): SpaceHook {
  return { name: '', type: 'command', command: '', onFail: 'stop', approval: false, maxRetries: DEFAULT_RETRIES };
}

/** Why a draft cannot be saved yet, or null when it can. */
function draftProblem(draft: SpaceHook): string | null {
  if (!draft.name.trim()) return 'Give the hook a name.';
  if (draft.type === 'command' && !draft.command?.trim()) return 'Write the command to run.';
  if (draft.type === 'agent') {
    if (!draft.prompt?.trim()) return 'Say what the agent must check.';
    if (draft.agent?.cliTool !== 'claude' && !draft.agent?.model?.includes('/')) return 'Write the model as provider/model.';
  }
  return null;
}

/** Only the fields of its type, so that changing type leaves nothing behind. */
function cleanDraft(draft: SpaceHook): SpaceHook {
  const { command, prompt, agent, ...common } = draft;
  const hook: SpaceHook = { ...common, name: draft.name.trim() };
  if (draft.type === 'command') hook.command = command?.trim();
  if (draft.type === 'agent') {
    hook.prompt = prompt?.trim();
    hook.agent  = agent;
  }
  if (draft.type === 'pr') hook.onFail = 'stop';
  return hook;
}

function HookForm({ initial, onSave, onCancel }: { initial: SpaceHook; onSave: (hook: SpaceHook) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<SpaceHook>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const update = (patch: Partial<SpaceHook>) => setDraft((d) => ({ ...d, ...patch }));
  const type = draft.type ?? 'command';
  const agent: AgentChoice = draft.agent ?? { cliTool: 'claude', model: 'sonnet' };

  const submit = () => {
    const found = draftProblem({ ...draft, type, agent: type === 'agent' ? agent : undefined });
    setProblem(found);
    if (!found) onSave(cleanDraft({ ...draft, type, agent: type === 'agent' ? agent : undefined }));
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3" data-testid="hook-form">
      <label className={labelClass}>
        Name
        <input type="text" value={draft.name} maxLength={60} placeholder="Tests" className={inputClass} onChange={(e) => update({ name: e.target.value })} />
      </label>

      <div className={labelClass}>
        What it does
        <div className="flex rounded-lg border border-border overflow-hidden" role="group" aria-label="What the hook does">
          {HOOK_TYPES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={type === option.value}
              onClick={() => update({ type: option.value })}
              className={`flex-1 px-2 py-1.5 text-xs focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${type === option.value ? 'bg-primary text-on-primary' : 'text-text-secondary hover:text-text-primary'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {type === 'command' && (
        <label className={labelClass}>
          Command
          <input type="text" value={draft.command ?? ''} maxLength={2000} placeholder="npm test" className={`${inputClass} font-mono`} onChange={(e) => update({ command: e.target.value })} />
        </label>
      )}

      {type === 'agent' && (
        <>
          <label className={labelClass}>
            Agent
            <select
              value={agent.cliTool}
              className={inputClass}
              onChange={(e) => update({ agent: e.target.value === 'claude' ? { cliTool: 'claude', model: 'sonnet' } : { cliTool: e.target.value } })}
            >
              {(Object.keys(HARNESS_NAMES) as DirectCliTool[]).map((tool) => <option key={tool} value={tool}>{HARNESS_NAMES[tool]}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            Model
            {agent.cliTool === 'claude'
              ? (
                <select value={agent.model ?? 'sonnet'} className={inputClass} onChange={(e) => update({ agent: { ...agent, model: e.target.value } })}>
                  {CLAUDE_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              )
              : (
                <input type="text" value={agent.model ?? ''} placeholder="provider/model" className={`${inputClass} font-mono`} onChange={(e) => update({ agent: { ...agent, model: e.target.value.trim() } })} />
              )}
          </label>
          <label className={labelClass}>
            What it must check
            <textarea value={draft.prompt ?? ''} rows={3} maxLength={5000} placeholder="Review the diff: bugs and security." className={inputClass} onChange={(e) => update({ prompt: e.target.value })} />
          </label>
        </>
      )}

      {type !== 'pr' && (
        <label className={labelClass}>
          If it fails
          <select value={draft.onFail ?? 'stop'} className={inputClass} onChange={(e) => update({ onFail: e.target.value as 'stop' | 'retry' })}>
            {(Object.keys(ON_FAIL_LABELS) as Array<keyof typeof ON_FAIL_LABELS>).map((value) => <option key={value} value={value}>{ON_FAIL_LABELS[value]}</option>)}
          </select>
        </label>
      )}

      <label className="flex items-center gap-2 text-xs text-text-primary">
        <input type="checkbox" checked={!!draft.approval} onChange={(e) => update({ approval: e.target.checked })} />
        Ask for my approval before running it
      </label>

      {type !== 'pr' && (
        <details className="text-xs text-text-secondary">
          <summary className="cursor-pointer select-none hover:text-text-primary">Advanced</summary>
          <div className="flex gap-3 mt-2">
            <label className={`${labelClass} flex-1`}>
              Time limit
              <select value={draft.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES} className={inputClass} onChange={(e) => update({ timeoutMinutes: Number(e.target.value) })}>
                {TIMEOUT_MINUTES.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
              </select>
            </label>
            {draft.onFail === 'retry' && (
              <label className={`${labelClass} flex-1`}>
                Maximum retries
                <select value={draft.maxRetries ?? DEFAULT_RETRIES} className={inputClass} onChange={(e) => update({ maxRetries: Number(e.target.value) })}>
                  {[1, 2, 3].map((count) => <option key={count} value={count}>{count}</option>)}
                </select>
              </label>
            )}
          </div>
        </details>
      )}

      {problem && <p className="text-xs text-error" role="alert">{problem}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="button" variant="secondary" size="sm" onClick={submit}>Keep this hook</Button>
      </div>
    </div>
  );
}

function hookSubtitle(hook: SpaceHook): string {
  if (hook.type === 'pr') return 'Pushes the branch and opens a pull request';
  if (hook.type === 'agent') return `${HARNESS_NAMES[hook.agent?.cliTool as DirectCliTool] ?? hook.agent?.cliTool} · ${hook.prompt}`;
  return hook.command ?? '';
}

function HookRow({ hook, index, count, onEdit, onRemove, onMoveUp }: {
  hook: SpaceHook;
  index: number;
  count: number;
  onEdit: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
}) {
  const type = hook.type ?? 'command';
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2" data-testid="hook-row">
      <span className="text-xs text-text-disabled w-3 flex-shrink-0">{index + 1}</span>
      {type === 'agent'
        ? <HarnessIcon cliTool={hook.agent?.cliTool ?? 'claude'} />
        : <span className="material-symbols-outlined text-base leading-none text-text-secondary" aria-hidden="true">{type === 'pr' ? 'call_merge' : 'terminal'}</span>}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary truncate">
          {hook.name}
          {hook.approval && <span className="ml-2 text-xs text-warning">Asks for approval</span>}
        </p>
        <p className={`text-xs text-text-secondary truncate ${type === 'command' ? 'font-mono' : ''}`} title={hookSubtitle(hook)}>{hookSubtitle(hook)}</p>
        {type !== 'pr' && <p className="text-xs text-text-disabled">If it fails: {ON_FAIL_LABELS[hook.onFail ?? 'stop'].toLowerCase()}</p>}
      </div>
      <Button type="button" variant="icon" aria-label={`Move ${hook.name} up`} disabled={index === 0 || count < 2} onClick={onMoveUp}>
        <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">arrow_upward</span>
      </Button>
      <Button type="button" variant="icon" aria-label={`Edit ${hook.name}`} onClick={onEdit}>
        <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">edit</span>
      </Button>
      <Button type="button" variant="icon" aria-label={`Remove ${hook.name}`} onClick={onRemove}>
        <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">delete</span>
      </Button>
    </div>
  );
}

interface SpaceHookSectionProps {
  value: SpaceHook[];
  onChange: (value: SpaceHook[]) => void;
  /** Whether a hook is open in the form, which Save must not silently drop. */
  onEditingChange?: (editing: boolean) => void;
  error?: string;
}

export function SpaceHookSection({ value, onChange, onEditingChange, error }: SpaceHookSectionProps) {
  // The index being edited, or 'new'.
  const [editing, setEditingState] = useState<number | 'new' | null>(null);
  const setEditing = (next: number | 'new' | null) => {
    setEditingState(next);
    onEditingChange?.(next !== null);
  };

  const replace = (index: number, hook: SpaceHook) => onChange(value.map((h, i) => (i === index ? hook : h)));
  const moveUp = (index: number) => {
    const next = [...value];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2" data-testid="space-hook-section">
      <div>
        <p className="text-sm font-medium text-text-primary">When the agent finishes</p>
        <p className="text-xs text-text-secondary mt-0.5">
          {value.length === 0 ? 'No hooks: the task goes to Done as soon as the agent finishes.' : 'These run in order, in the task\'s worktree. The task goes to Done when they all pass.'}
        </p>
      </div>

      {value.map((hook, index) => (editing === index
        ? (
          <HookForm
            key={hook.id ?? index}
            initial={hook}
            onSave={(saved) => { replace(index, saved); setEditing(null); }}
            onCancel={() => setEditing(null)}
          />
        )
        : (
          <HookRow
            key={hook.id ?? index}
            hook={hook}
            index={index}
            count={value.length}
            onEdit={() => setEditing(index)}
            onRemove={() => { onChange(value.filter((_, i) => i !== index)); setEditing(null); }}
            onMoveUp={() => { moveUp(index); setEditing(null); }}
          />
        )))}

      {editing === 'new' && (
        <HookForm
          initial={emptyDraft()}
          onSave={(saved) => { onChange([...value, saved]); setEditing(null); }}
          onCancel={() => setEditing(null)}
        />
      )}
      {editing === null && value.length < 10 && (
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing('new')}>
            <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">add</span>
            Add hook
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-error" role="alert">{error}</p>}
    </div>
  );
}
