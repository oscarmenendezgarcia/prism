/**
 * Tiny store for the shared visually-hidden aria-live announcer.
 *
 * See ADR-1 (keyboard-card-reorder) — position changes are status messages
 * (WCAG 4.1.3), not notifications, so they must not go through the toast
 * channel. This store feeds a single <Announcer/> element mounted once in
 * <Board/>.
 *
 * `nonce` increments on every call so that two consecutive announcements of
 * the same string still update the rendered text node (a bare live region
 * silently dedupes identical text and the SR never re-reads it).
 */

import { create } from 'zustand';

interface AnnouncerState {
  message: string;
  /** Bumped on every announce() so identical strings still change the DOM. */
  nonce: number;
  announce: (message: string) => void;
}

export const useAnnouncer = create<AnnouncerState>((set) => ({
  message: '',
  nonce: 0,
  announce: (message: string) =>
    set((s) => ({ message, nonce: s.nonce + 1 })),
}));
