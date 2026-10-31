/**
 * Choose what the board and the list show. Each choice applies at once.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { IssueFilters, Status } from '@/types';
import * as api from '@/api/client';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useDebounce } from '@/hooks/useDebounce';
import { AGENT_IDS, AGENT_NAMES } from '@/utils/agents';
import { PRIORITIES, TYPES } from '@/utils/issues';
import { hasFilters } from '@/utils/issueFilters';

export const DUE_OPTIONS: { id: NonNullable<IssueFilters['due']>; label: string }[] = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'week', label: 'Next 7 days' },
  { id: 'none', label: 'No date' },
];

const NO_STATUSES: Status[] = [];

interface Option {
  id: string;
  label: string;
}

/** A field with several values to choose from: a heading and a list of checkboxes. */
function Choices({ title, options, chosen, onChange }: { title: string; options: Option[]; chosen: string[] | undefined; onChange: (values: string[]) => void }) {
  if (options.length === 0) return null;
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-[11px] font-medium text-text-secondary">{title}</legend>
      <div className="flex flex-col max-h-36 overflow-y-auto">
        {options.map(({ id, label }) => {
          const on = chosen?.includes(id) ?? false;
          return (
            <label key={id || '-none'} className="flex items-center gap-2 min-h-7 px-1 rounded text-xs text-text-primary cursor-pointer hover:bg-surface-variant">
              <input
                type="checkbox"
                checked={on}
                onChange={() => onChange(on ? (chosen ?? []).filter((v) => v !== id) : [...(chosen ?? []), id])}
                className="accent-primary flex-shrink-0"
              />
              <span className="truncate">{label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

interface FilterPanelProps {
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

export function FilterPanel({ onClose, anchorRef }: FilterPanelProps) {
  const filters = useAppStore((s) => s.filters);
  const setFilters = useAppStore((s) => s.setFilters);
  const statuses = useAppStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId)?.statuses) ?? NO_STATUSES;
  const epics = useAppStore((s) => s.epics);
  const activeSpaceId = useAppStore((s) => s.activeSpaceId);
  const people = useAuthStore((s) => s.people);
  const loadPeople = useAuthStore((s) => s.loadPeople);
  const [labels, setLabels] = useState<string[]>([]);
  const [text, setText] = useState(filters.q ?? '');
  const debouncedText = useDebounce(text, 250);
  const panelRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void loadPeople(); }, [loadPeople]);
  useEffect(() => { textRef.current?.focus(); }, []);

  useEffect(() => {
    let current = true;
    api.getLabels(activeSpaceId).then((found) => { if (current) setLabels(found); }).catch(() => {});
    return () => { current = false; };
  }, [activeSpaceId]);

  useEffect(() => {
    const { filters: now, setFilters: apply } = useAppStore.getState();
    if ((now.q ?? '') !== debouncedText.trim()) apply({ ...now, q: debouncedText });
  }, [debouncedText]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !anchorRef.current?.contains(target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onClose();
      anchorRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, anchorRef]);

  const assignees: Option[] = [
    { id: '', label: 'Unassigned' },
    ...people.filter((p) => p.active).map((p) => ({ id: p.name, label: p.name })),
    ...AGENT_IDS.map((agent) => ({ id: agent, label: AGENT_NAMES[agent] })),
  ];
  // A value chosen before, or in a link, stays visible until someone removes it.
  const withChosen = (options: Option[], chosen: string[] | undefined): Option[] => [
    ...options,
    ...(chosen ?? []).filter((id) => !options.some((o) => o.id === id)).map((id) => ({ id, label: id })),
  ];
  const update = (change: Partial<IssueFilters>) => setFilters({ ...useAppStore.getState().filters, ...change });

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Filter issues"
      data-testid="filter-panel"
      className="fixed sm:absolute inset-x-2 sm:inset-x-auto top-28 sm:top-9 sm:left-0 z-40 sm:w-[36rem] max-h-[70vh] overflow-y-auto p-3 rounded-lg border border-border bg-surface-elevated shadow-lg"
    >
      <label className="block mb-3">
        <span className="flex items-center justify-between mb-1 text-[11px] font-medium text-text-secondary">
          Text
          {/* On a phone there are no tokens to remove. */}
          {hasFilters(filters) && (
            <button
              type="button"
              onClick={() => { setText(''); setFilters({}); }}
              data-testid="filter-clear-panel"
              className="sm:hidden text-xs text-primary"
            >
              Clear all
            </button>
          )}
        </span>
        <input
          ref={textRef}
          type="text"
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          placeholder="Title or key"
          data-testid="filter-text"
          className="w-full h-8 px-2 rounded-md border border-border bg-surface text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </label>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
        <Choices
          title="Status"
          options={withChosen(statuses.map((s) => ({ id: s.id, label: s.name })), filters.status)}
          chosen={filters.status}
          onChange={(status) => update({ status })}
        />
        <Choices title="Assignee" options={withChosen(assignees, filters.assignee)} chosen={filters.assignee} onChange={(assignee) => update({ assignee })} />
        <Choices
          title="Type"
          options={TYPES.map((t) => ({ id: t.id, label: t.label }))}
          chosen={filters.type}
          onChange={(type) => update({ type: type as IssueFilters['type'] })}
        />
        <Choices
          title="Priority"
          options={PRIORITIES.map((p) => ({ id: p.id, label: p.label }))}
          chosen={filters.priority}
          onChange={(priority) => update({ priority: priority as IssueFilters['priority'] })}
        />
        <Choices
          title="Epic"
          options={[{ id: '', label: 'No epic' }, ...[...epics].sort((a, b) => a.title.localeCompare(b.title)).map((e) => ({ id: e.id, label: e.title }))]}
          chosen={filters.epic}
          onChange={(epic) => update({ epic })}
        />
        <Choices title="Label" options={withChosen(labels.map((l) => ({ id: l, label: l })), filters.label)} chosen={filters.label} onChange={(label) => update({ label })} />
        <fieldset className="min-w-0">
          <legend className="mb-1 text-[11px] font-medium text-text-secondary">Due</legend>
          <div className="flex flex-col">
            {[{ id: undefined, label: 'Any' }, ...DUE_OPTIONS].map(({ id, label }) => (
              <label key={label} className="flex items-center gap-2 min-h-7 px-1 rounded text-xs text-text-primary cursor-pointer hover:bg-surface-variant">
                <input type="radio" name="filter-due" checked={filters.due === id} onChange={() => update({ due: id })} className="accent-primary flex-shrink-0" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
}
