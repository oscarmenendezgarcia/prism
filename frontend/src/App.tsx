/**
 * Top-level application component.
 * Renders the Kanban board directly — no routing needed.
 *
 * Layout:
 *   Header (sticky)
 *   SpaceTabs + Board
 *   Portals: modals + Toast
 */

import React, { useEffect } from 'react';
import { Header } from '@/components/layout/Header';
import { SpaceTabs } from '@/components/layout/SpaceTabs';
import { Board } from '@/components/board/Board';
import { TaskDetailPanel } from '@/components/board/TaskDetailPanel';
import { CreateTaskModal } from '@/components/modals/CreateTaskModal';
import { AttachmentModal } from '@/components/modals/AttachmentModal';
import { MarkdownModal } from '@/components/modals/MarkdownModal';
import { SpaceModal } from '@/components/modals/SpaceModal';
import { DeleteSpaceDialog } from '@/components/modals/DeleteSpaceDialog';
import { GlobalSearchModal } from '@/components/modals/GlobalSearchModal';
import { Toast } from '@/components/shared/Toast';
import { useAppStore } from '@/stores/useAppStore';
import { usePolling } from '@/hooks/usePolling';
import { useTaskRunsPolling } from '@/hooks/useTaskRunsPolling';

/** React Error Boundary to prevent white-screen crashes. */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-4 p-8 text-center">
          <span className="material-symbols-outlined text-5xl text-error" aria-hidden="true">
            error
          </span>
          <h1 className="text-xl font-semibold text-text-primary">Something went wrong</h1>
          <p className="text-sm text-text-secondary max-w-md">
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button
            className="px-4 py-2 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary-hover"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const loadSpaces           = useAppStore((s) => s.loadSpaces);
  const isGlobalSearchOpen     = useAppStore((s) => s.isGlobalSearchOpen);
  const openGlobalSearch       = useAppStore((s) => s.openGlobalSearch);
  const closeGlobalSearch      = useAppStore((s) => s.closeGlobalSearch);

  useEffect(() => {
    loadSpaces();
  }, [loadSpaces]);

  // Global ⌘K / Ctrl+K keyboard shortcut — opens GlobalSearchModal.
  // Does NOT fire when focus is already inside a text input / textarea /
  // contenteditable that is NOT the search input itself (ADR-1 §FR-3, NFR-4).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.key === 'k' && (e.metaKey || e.ctrlKey))) return;

      const target = e.target as HTMLElement;
      const tag    = target.tagName.toLowerCase();
      const isTextInput =
        tag === 'textarea' ||
        (tag === 'input' && (target as HTMLInputElement).type !== 'hidden') ||
        target.isContentEditable;

      // Allow the shortcut to fire when the focused element is the search input
      // (role="combobox") so the user can re-open without moving focus elsewhere.
      const isSearchInput = target.getAttribute('role') === 'combobox';

      if (isTextInput && !isSearchInput) return;

      e.preventDefault();
      openGlobalSearch();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openGlobalSearch]);

  usePolling();
  useTaskRunsPolling();

  return (
    <div className="flex flex-col h-full">
      <Header />

      <div className="flex-1 overflow-hidden flex flex-col">
        <SpaceTabs />
        <div className="flex-1 overflow-hidden relative">
          <Board />
        </div>
      </div>

      {/* Task detail panel — z-50, above board (z-0/10), below modals (z-60+).
          Rendered at App root so it overlays the full viewport without being
          inside any scrollable column container. ADR-1 (task-detail-edit) §3.4. */}
      <TaskDetailPanel />

      <CreateTaskModal />
      <AttachmentModal />
      <MarkdownModal />
      <SpaceModal />
      <DeleteSpaceDialog />
      <GlobalSearchModal open={isGlobalSearchOpen} onClose={closeGlobalSearch} />

      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
