/**
 * Tiny store for the shared visually-hidden aria-live announcer.
 *
 * See ADR-1 (keyboard-card-reorder) — position changes are status messages
 * (WCAG 4.1.3), not notifications, so they must not go through the toast
 * channel. This store feeds a single <Announcer/> element mounted once in
 * <Board/>.
 *
 * `nonce` increments on every call. <Announcer/> keys its message span on
 * `nonce` so React remounts the text node on every announcement, even when
 * two consecutive messages are identical — a bare live region silently
 * dedupes identical text and the SR never re-reads it otherwise.
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
