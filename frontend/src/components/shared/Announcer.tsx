/**
 * Visually-hidden shared aria-live announcer.
 *
 * Mounted once in <Board/>. Renders the latest message from useAnnouncer
 * inside a `role="status" aria-live="polite"` region so screen readers pick
 * up transient status text (e.g. "Task X moved to position N of M") without
 * moving focus or showing anything on screen.
 *
 * The message is wrapped in a child keyed on `nonce` so React always
 * replaces the text node on repeat announcements of the same string — bare
 * live regions silently dedupe identical text and the SR would otherwise
 * stay quiet.
 */

import React from 'react';
import { useAnnouncer } from '@/stores/useAnnouncer';

export function Announcer() {
  const message = useAnnouncer((s) => s.message);
  const nonce   = useAnnouncer((s) => s.nonce);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      data-testid="announcer"
    >
      <span key={nonce}>{message}</span>
    </div>
  );
}
