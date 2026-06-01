/**
 * Folio store — navigable index of Chapters and Pages (T-004: folio-index-ui)
 *
 * View state:
 *   'chapters' → chapter list (index)
 *   'pages'    → page list for the active chapter
 *   'page'     → single page view / editor
 *
 * All API calls are space-scoped via useAppStore.getState().activeSpaceId.
 * Switching spaces resets the store to its initial state and reloads the index.
 */

import { create } from 'zustand';
import * as api from '@/api/client';
import type { FolioChapter, FolioPageMeta, FolioPage } from '@/api/client';
import { useAppStore } from '@/stores/useAppStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FolioView = 'chapters' | 'pages' | 'page';

interface FolioState {
  // ── View ──────────────────────────────────────────────────────────────────
  view:              FolioView;
  active:            boolean;

  // ── Chapter list ─────────────────────────────────────────────────────────
  chapters:          FolioChapter[];

  // ── Page list ─────────────────────────────────────────────────────────────
  activeChapterSlug: string | null;
  pages:             FolioPageMeta[];

  // ── Single page ───────────────────────────────────────────────────────────
  activePage:        FolioPage | null;

  // ── Async state ───────────────────────────────────────────────────────────
  loading:           boolean;
  error:             string | null;
  isMutating:        boolean;

  // ── Actions ───────────────────────────────────────────────────────────────

  /** Load the folio index for the active space. */
  loadIndex: () => Promise<void>;

  /** Navigate into a chapter and load its pages. */
  openChapter: (chapterSlug: string) => Promise<void>;

  /** Navigate into a single page (loads full content). */
  openPage: (chapterSlug: string, pageSlug: string) => Promise<void>;

  /** Navigate back: page → pages, pages → chapters. */
  back: () => void;

  /** Create a new page (and activate the folio if first page in space). */
  createPage: (payload: { slug: string; title?: string; content?: string }) => Promise<FolioPage | null>;

  /** Save (update) the active page's content and/or title. */
  savePage: (chapterSlug: string, pageSlug: string, updates: { content?: string; title?: string; pinned?: boolean }) => Promise<void>;

  /** Delete a page and navigate back to the page list. */
  deletePage: (chapterSlug: string, pageSlug: string) => Promise<void>;

  /** Reset to initial state. */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL: Pick<FolioState,
  'view' | 'active' | 'chapters' | 'activeChapterSlug' | 'pages' | 'activePage' | 'loading' | 'error' | 'isMutating'
> = {
  view:              'chapters',
  active:            false,
  chapters:          [],
  activeChapterSlug: null,
  pages:             [],
  activePage:        null,
  loading:           false,
  error:             null,
  isMutating:        false,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useFolioStore = create<FolioState>((set, get) => {

  // Helper: get the active space ID from the root store (avoids circular import).
  function spaceId(): string {
    return useAppStore.getState().activeSpaceId;
  }

  // Helper: surface a toast via the root store.
  function toast(message: string, type: 'success' | 'error' = 'success') {
    useAppStore.getState().showToast(message, type);
  }

  return {
    ...INITIAL,

    // ── loadIndex ────────────────────────────────────────────────────────────

    loadIndex: async () => {
      set({ loading: true, error: null });
      try {
        const index = await api.getFolioIndex(spaceId());
        set({
          active:   index.active,
          chapters: index.chapters,
          loading:  false,
        });
      } catch (err) {
        const message = (err as Error).message ?? 'Failed to load Folio';
        console.error('[useFolioStore] loadIndex error:', message);
        set({ loading: false, error: message });
        toast(`Failed to load Folio: ${message}`, 'error');
      }
    },

    // ── openChapter ──────────────────────────────────────────────────────────

    openChapter: async (chapterSlug: string) => {
      set({ loading: true, error: null, activeChapterSlug: chapterSlug, view: 'pages' });
      try {
        const pages = await api.getChapterPages(spaceId(), chapterSlug);
        set({ pages, loading: false });
      } catch (err) {
        const message = (err as Error).message ?? 'Failed to load pages';
        console.error('[useFolioStore] openChapter error:', message);
        set({ loading: false, error: message });
        toast(`Failed to load pages: ${message}`, 'error');
      }
    },

    // ── openPage ─────────────────────────────────────────────────────────────

    openPage: async (chapterSlug: string, pageSlug: string) => {
      set({ loading: true, error: null, view: 'page' });
      try {
        const page = await api.getFolioPage(spaceId(), chapterSlug, pageSlug);
        set({ activePage: page, loading: false });
      } catch (err) {
        const message = (err as Error).message ?? 'Failed to load page';
        console.error('[useFolioStore] openPage error:', message);
        set({ loading: false, error: message, view: get().activeChapterSlug ? 'pages' : 'chapters' });
        toast(`Failed to load page: ${message}`, 'error');
      }
    },

    // ── back ─────────────────────────────────────────────────────────────────

    back: () => {
      const { view, activeChapterSlug } = get();
      if (view === 'page') {
        set({ view: 'pages', activePage: null });
      } else if (view === 'pages') {
        set({ view: 'chapters', activeChapterSlug: null, pages: [] });
      }
      // 'chapters' is the root — back() is a no-op.
      void activeChapterSlug; // suppress TS unused-var warning in simple cases
    },

    // ── createPage ───────────────────────────────────────────────────────────

    createPage: async (payload) => {
      set({ isMutating: true });
      try {
        const page = await api.createFolioPage(spaceId(), payload);
        toast('Page created');
        // Reload the index so chapter list + counts update.
        await get().loadIndex();
        return page;
      } catch (err) {
        const message = (err as Error).message ?? 'Failed to create page';
        console.error('[useFolioStore] createPage error:', message);
        toast(message, 'error');
        return null;
      } finally {
        set({ isMutating: false });
      }
    },

    // ── savePage ─────────────────────────────────────────────────────────────

    savePage: async (chapterSlug, pageSlug, updates) => {
      set({ isMutating: true });
      try {
        const updated = await api.updateFolioPage(spaceId(), chapterSlug, pageSlug, updates);
        set({ activePage: updated });
        toast('Page saved');
      } catch (err) {
        const message = (err as Error).message ?? 'Failed to save page';
        console.error('[useFolioStore] savePage error:', message);
        toast(message, 'error');
        throw err; // Re-throw so editors can react to failures.
      } finally {
        set({ isMutating: false });
      }
    },

    // ── deletePage ───────────────────────────────────────────────────────────

    deletePage: async (chapterSlug, pageSlug) => {
      set({ isMutating: true });
      try {
        await api.deleteFolioPage(spaceId(), chapterSlug, pageSlug);
        toast('Page deleted');
        // Navigate back to the page list and reload it.
        set({ view: 'pages', activePage: null });
        const pages = await api.getChapterPages(spaceId(), chapterSlug);
        set({ pages });
        // Also refresh the index so page counts update.
        await get().loadIndex();
      } catch (err) {
        const message = (err as Error).message ?? 'Failed to delete page';
        console.error('[useFolioStore] deletePage error:', message);
        toast(message, 'error');
      } finally {
        set({ isMutating: false });
      }
    },

    // ── reset ─────────────────────────────────────────────────────────────────

    reset: () => set(INITIAL),
  };
});

// ---------------------------------------------------------------------------
// Convenience selectors
// ---------------------------------------------------------------------------

export const useFolioView = () => useFolioStore((s) => s.view);
export const useFolioActive = () => useFolioStore((s) => s.active);
export const useFolioChapters = () => useFolioStore((s) => s.chapters);
export const useFolioPages = () => useFolioStore((s) => s.pages);
export const useFolioActivePage = () => useFolioStore((s) => s.activePage);
export const useFolioLoading = () => useFolioStore((s) => s.loading);
export const useFolioMutating = () => useFolioStore((s) => s.isMutating);
