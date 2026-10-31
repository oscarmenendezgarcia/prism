/**
 * Change the selected issues. Native lists, as elsewhere for the assignee: they work the same
 * with a mouse, a keyboard and a phone. From a certain size it asks first.
 */

import { useState } from 'react';
import type { BulkChanges, Priority, Status } from '@/types';
import { AssigneeSelect } from '@/components/shared/AssigneeSelect';
import { Button } from '@/components/shared/Button';
import { LabelsInput } from '@/components/shared/LabelsInput';
import { useAppStore } from '@/stores/useAppStore';
import { useListStore } from '@/stores/useListStore';
import { assigneeLabel } from '@/utils/agents';
import { PRIORITIES } from '@/utils/issues';

/** From this many issues, a change is confirmed before it is made. */
const CONFIRM_FROM = 20;
const NO_STATUSES: Status[] = [];
const SELECT = 'h-7 max-w-[7.5rem] pl-2 pr-1 rounded-md border border-border bg-surface text-xs text-text-primary cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50';
const LABEL_INPUT = 'w-full h-8 px-2 rounded-md border border-border bg-surface text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/50';

export function BulkBar() {
  const statuses = useAppStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId)?.statuses) ?? NO_STATUSES;
  const selected = useListStore((s) => s.selected);
  const clearSelection = useListStore((s) => s.clearSelection);
  const changeSelected = useListStore((s) => s.changeSelected);
  const [pending, setPending] = useState<{ changes: BulkChanges; says: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [adding, setAdding] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string[]>([]);

  const apply = async (changes: BulkChanges) => {
    setBusy(true);
    setPending(null);
    const worked = await changeSelected(changes);
    setBusy(false);
    if (worked) {
      setLabelsOpen(false);
      setAdding([]);
      setRemoving([]);
    }
  };

  const ask = (changes: BulkChanges, says: string) => {
    if (selected.size >= CONFIRM_FROM) setPending({ changes, says });
    else void apply(changes);
  };

  const n = selected.size;

  return (
    <div
      role="region"
      aria-label={`${n} issues selected`}
      data-testid="bulk-bar"
      className="absolute bottom-4 inset-x-2 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-max z-20 rounded-lg border border-border bg-surface-elevated shadow-lg"
    >
      {labelsOpen && !pending && (
        <div data-testid="bulk-labels" className="flex flex-col gap-2 p-3 border-b border-border">
          <div>
            <span className="block mb-1 text-[11px] font-medium text-text-secondary">Add labels</span>
            <LabelsInput labels={adding} onChange={setAdding} disabled={busy} inputClassName={LABEL_INPUT} />
          </div>
          <div>
            <span className="block mb-1 text-[11px] font-medium text-text-secondary">Remove labels</span>
            <LabelsInput labels={removing} onChange={setRemoving} disabled={busy} inputClassName={LABEL_INPUT} />
          </div>
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              disabled={busy || (adding.length === 0 && removing.length === 0)}
              onClick={() => ask(
                { ...(adding.length > 0 && { addLabels: adding }), ...(removing.length > 0 && { removeLabels: removing }) },
                [adding.length > 0 && `add ${adding.join(', ')}`, removing.length > 0 && `remove ${removing.join(', ')}`].filter(Boolean).join(' and '),
              )}
            >
              Apply
            </Button>
          </div>
        </div>
      )}

      {pending ? (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="bulk-confirm">
          <span className="text-xs text-text-primary">Change {n} issues: {pending.says}?</span>
          <Button variant="ghost" size="sm" onClick={() => setPending(null)}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={() => void apply(pending.changes)}>Change {n} issues</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <span data-testid="bulk-count" className="text-xs font-medium text-text-primary whitespace-nowrap">{n} selected</span>
          <select
            value=""
            disabled={busy}
            aria-label="Change status"
            data-testid="bulk-status"
            className={SELECT}
            onChange={(e) => {
              const status = statuses.find((s) => s.id === e.target.value);
              if (status) ask({ statusId: status.id }, `move to ${status.name}`);
            }}
          >
            <option value="" disabled>Status</option>
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <span className="inline-flex" data-testid="bulk-assignee">
            <AssigneeSelect
              id="bulk-assignee"
              value=""
              placeholder="Assignee"
              aria-label="Change assignee"
              className={SELECT}
              onChange={(assigned) => ask({ assigned }, assigned ? `assign to ${assigneeLabel(assigned)}` : 'unassign')}
            />
          </span>
          <select
            value=""
            disabled={busy}
            aria-label="Change priority"
            data-testid="bulk-priority"
            className={SELECT}
            onChange={(e) => {
              const priority = PRIORITIES.find((p) => p.id === e.target.value);
              if (priority) ask({ priority: priority.id as Priority }, `set priority to ${priority.label}`);
            }}
          >
            <option value="" disabled>Priority</option>
            {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <Button variant="secondary" size="sm" onClick={() => setLabelsOpen((was) => !was)} aria-expanded={labelsOpen} data-testid="bulk-labels-button">Labels</Button>
          <button
            type="button"
            onClick={clearSelection}
            aria-label="Clear selection"
            data-testid="bulk-clear"
            className="flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:bg-surface-variant hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-fast"
          >
            <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">close</span>
          </button>
        </div>
      )}
    </div>
  );
}
