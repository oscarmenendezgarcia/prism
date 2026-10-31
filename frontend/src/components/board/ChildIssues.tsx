/**
 * The issues under this one: an epic's issues, or an issue's sub-tasks.
 */

import React, { useState } from 'react';
import * as api from '@/api/client';
import { Button } from '@/components/shared/Button';
import { useAppStore, useTasks } from '@/stores/useAppStore';
import { useCanEdit } from '@/stores/useAuthStore';
import { boardIndex, parentIssueOf, progressOf, statusDotClass } from '@/utils/issues';
import type { Task } from '@/types';

interface ChildIssuesProps {
  task: Task;
  spaceId: string;
}

export function ChildIssues({ task, spaceId }: ChildIssuesProps) {
  const canEdit = useCanEdit();
  const board = useTasks();
  const openDetailPanel = useAppStore((s) => s.openDetailPanel);
  const loadBoard = useAppStore((s) => s.loadBoard);
  const showToast = useAppStore((s) => s.showToast);
  const statuses = useAppStore((s) => s.spaces.find((sp) => sp.id === spaceId)?.statuses) ?? [];

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const index = boardIndex(board);
  // A sub-task cannot have sub-tasks of its own.
  if (parentIssueOf(task, index)) return null;

  const isEpic = task.type === 'epic';
  const children = index.children.get(task.id) ?? [];
  const { done, total } = progressOf(task.id, index);
  if (!canEdit && children.length === 0) return null;

  const add = async () => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await api.createTask(spaceId, { title: trimmed, type: isEpic ? 'feature' : 'chore', parentId: task.id });
      setTitle('');
      await loadBoard();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid="child-issues">
      <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.10em]">
        {isEpic ? 'Issues in this epic' : 'Sub-tasks'}{total > 0 && ` · ${done} of ${total}${isEpic ? ' done' : ''}`}
      </span>
      {isEpic && total > 0 && (
        <progress
          className="block w-full h-1 rounded-full overflow-hidden appearance-none [&::-webkit-progress-bar]:bg-surface-variant [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
          max={total}
          value={done}
          aria-label="Issues done"
        />
      )}
      {children.map((child) => {
        const status = statuses.find((s) => s.id === child.statusId);
        return (
          <button
            key={child.id}
            type="button"
            onClick={() => openDetailPanel(child)}
            data-testid="child-issue"
            className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border/40 text-left hover:border-primary/40 hover:bg-surface-variant/50 focus:outline-hidden focus:ring-2 focus:ring-primary transition-colors duration-fast"
          >
            {status && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass(status, statuses)}`} title={status.name} aria-label={status.name} />}
            <span className="font-mono text-[11px] font-semibold text-text-secondary flex-shrink-0">{child.key}</span>
            <span className={`text-sm truncate ${child.category === 'done' ? 'line-through text-text-disabled' : 'text-text-primary'}`}>{child.title}</span>
          </button>
        );
      })}
      {!canEdit ? null : adding ? (
        <input
          type="text"
          autoFocus
          data-escape-local
          value={title}
          maxLength={200}
          disabled={saving}
          placeholder={isEpic ? 'Title of the new issue' : 'Title of the sub-task'}
          aria-label={isEpic ? 'New issue title' : 'New sub-task title'}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => { if (!title.trim()) setAdding(false); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void add(); }
            if (e.key === 'Escape') { e.stopPropagation(); setTitle(''); setAdding(false); }
          }}
          className="w-full px-3 py-2 rounded-lg bg-surface/60 border border-border/40 text-sm text-text-primary placeholder:text-text-tertiary/50 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/60"
        />
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setAdding(true)}
          data-testid="add-child-issue"
          className="self-start -ml-2"
        >
          <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">add</span>
          {isEpic ? 'Add issue' : 'Add sub-task'}
        </Button>
      )}
    </div>
  );
}
