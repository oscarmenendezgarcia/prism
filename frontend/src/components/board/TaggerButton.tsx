/**
 * TaggerButton — triggers the AI auto-tagger for the current space.
 *
 * ADR-1 (Tagger Agent): ghost Button variant with auto_fix_high icon.
 * Shows a spinner while loading. Wires to useAppStore tagger slice.
 */

import React from 'react';
import { Button } from '@/components/shared/Button';
import { useAppStore, useTaggerLoading } from '@/stores/useAppStore';
import * as api from '@/api/client';

export function TaggerButton() {
  const loading    = useTaggerLoading();
  const spaceId    = useAppStore((s) => s.activeSpaceId);
  const startTagger    = useAppStore((s) => s.startTagger);
  const setSuggestions = useAppStore((s) => s.setSuggestions);
  const setTaggerError = useAppStore((s) => s.setTaggerError);
  const showToast      = useAppStore((s) => s.showToast);

  async function handleClick() {
    if (loading) return;
    startTagger();
    try {
      const result = await api.runTagger(spaceId, { improveDescriptions: false });
      if (result.suggestions.length === 0 && result.skipped.length === 0) {
        // Empty board — nothing to show, close the modal state
        setSuggestions(result);
      } else {
        setSuggestions(result);
      }
    } catch (err) {
      const message = (err as Error).message || 'Tagger failed';
      setTaggerError(message);
      showToast(message, 'error');
    }
  }

  return (
    <Button
      variant="ghost"
      onClick={handleClick}
      disabled={loading}
      aria-busy={loading}
      aria-label="Auto-tag cards in this space"
      title="Auto-tag"
      className="gap-1.5"
    >
      {loading ? (
        <span
          className="material-symbols-outlined text-base animate-spin"
          aria-hidden="true"
        >
          progress_activity
        </span>
      ) : (
        <span
          className="material-symbols-outlined text-base"
          aria-hidden="true"
        >
          auto_fix_high
        </span>
      )}
      <span className="hidden md:inline">Auto-tag</span>
    </Button>
  );
}
