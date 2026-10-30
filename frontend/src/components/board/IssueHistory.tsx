/**
 * What has changed in an issue, newest first.
 */

import React, { useEffect, useState } from 'react';
import { getTaskHistory } from '@/api/client';
import { formatRelativeTime } from '@/utils/formatRelativeTime';
import { formatTimestamp } from '@/utils/formatTimestamp';
import { formatDueDate, priorityOf } from '@/utils/issues';
import type { HistoryEntry, Priority } from '@/types';

/** The name for a field in "changed the …". */
const FIELD_NAMES: Record<string, string> = {
  status: 'status',
  category: 'category of its status',
  priority: 'priority',
  type: 'type',
  title: 'title',
  labels: 'labels',
  estimate: 'estimate',
  dueDate: 'due date',
  parentId: 'parent',
  dependsOn: 'dependencies',
};

function readable(field: string, value: string | null): string | null {
  if (value === null) return null;
  if (field === 'priority') return priorityOf(value as Priority).label;
  if (field === 'dueDate') return formatDueDate(value);
  if (field === 'category') return { todo: 'To do', 'in-progress': 'In progress', done: 'Done' }[value] ?? value;
  return value;
}

function HistoryLine({ entry }: { entry: HistoryEntry }) {
  const { field, oldValue, newValue } = entry;
  if (field === 'created') return <>created it</>;
  if (field === 'description') return <>changed the description</>;
  if (field === 'assigned') return <>{newValue ? <>assigned it to <b className="font-medium text-text-primary">{newValue}</b></> : 'unassigned it'}</>;

  const before = readable(field, oldValue);
  const after = readable(field, newValue);
  return (
    <>
      changed {FIELD_NAMES[field] ?? field}
      {before && <> <span className="line-through text-text-disabled">{before}</span></>}
      {before && after && ' →'}
      {after ? <> <b className="font-medium text-text-primary">{after}</b></> : <> to none</>}
    </>
  );
}

interface IssueHistoryProps {
  spaceId: string;
  taskId: string;
  /** Changes when the issue does, so that the list follows it. */
  version?: string;
}

export function IssueHistory({ spaceId, taskId, version }: IssueHistoryProps) {
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    getTaskHistory(spaceId, taskId)
      .then((data) => { if (current) { setHistory(data.history); setFailed(false); } })
      .catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [spaceId, taskId, version]);

  if (failed) return <p className="text-sm text-error">Could not load the history.</p>;
  if (!history) return <p className="text-sm text-text-disabled">Loading…</p>;
  if (history.length === 0) {
    return <p className="text-sm text-text-disabled">Nothing recorded yet. Changes appear here from now on.</p>;
  }

  return (
    <ul className="flex flex-col" data-testid="issue-history">
      {history.map((entry) => (
        <li key={entry.id} className="flex items-baseline gap-2 py-2 border-b border-border/30 last:border-b-0 text-sm text-text-secondary" data-testid="history-entry">
          <span className="min-w-0">
            <b className="font-medium text-text-primary">{entry.actor === 'user' ? 'You' : entry.actor}</b>{' '}
            <HistoryLine entry={entry} />
          </span>
          <time dateTime={entry.createdAt} title={formatTimestamp(entry.createdAt)} className="ml-auto flex-shrink-0 text-xs text-text-tertiary">
            {formatRelativeTime(entry.createdAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}
