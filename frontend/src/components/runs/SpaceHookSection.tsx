/**
 * Space settings: the command to run when an agent finishes a task.
 */

import React, { useEffect, useState } from 'react';
import * as api from '@/api/client';
import { Button } from '@/components/shared/Button';
import { useAppStore } from '@/stores/useAppStore';
import type { Space } from '@/types';

const inputClass = 'w-full px-3 py-2 rounded-lg bg-surface-variant border border-border text-sm text-text-primary placeholder:text-text-disabled focus:outline-hidden focus:border-primary transition-colors duration-fast';

export function SpaceHookSection({ space }: { space: Space }) {
  const saved = space.hooks?.[0];
  const [name, setName]         = useState(saved?.name ?? 'Tests');
  const [command, setCommand]   = useState(saved?.command ?? '');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const showToast  = useAppStore((s) => s.showToast);
  const loadSpaces = useAppStore((s) => s.loadSpaces);

  useEffect(() => {
    setName(saved?.name ?? 'Tests');
    setCommand(saved?.command ?? '');
    setError('');
  }, [saved?.name, saved?.command]);

  const trimmed = command.trim();
  const changed = trimmed !== (saved?.command ?? '') || (trimmed !== '' && name.trim() !== (saved?.name ?? ''));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.updateSpaceHooks(space.id, trimmed ? [{ name: name.trim(), command: trimmed }] : []);
      await loadSpaces();
      showToast(trimmed ? 'Check saved' : 'Check removed', 'success');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="space-hook-section">
      <div>
        <p className="text-sm font-medium text-text-primary">When the agent finishes</p>
        <p className="text-xs text-text-secondary mt-0.5">
          Runs in the task's worktree. If it fails, the card stays open with its output.
        </p>
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        placeholder="Name"
        aria-label="Check name"
        className={inputClass}
      />
      <input
        type="text"
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        maxLength={2000}
        placeholder="npm test"
        aria-label="Command"
        className={`${inputClass} font-mono`}
      />
      {error && <p className="text-xs text-error" role="alert">{error}</p>}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={saving || !changed || (trimmed !== '' && !name.trim())}
          onClick={() => { void save(); }}
        >
          {saving ? 'Updating…' : 'Update check'}
        </Button>
      </div>
    </div>
  );
}
