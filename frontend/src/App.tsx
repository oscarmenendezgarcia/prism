/**
 * Top-level application component.
 * Renders the Kanban board directly — no routing needed.
 *
 * Layout:
 *   Header (sticky)
 *   SpaceTabs + Board + optional TerminalPanel + optional ConfigPanel
 *   Portals: modals + Toast
 */

import React, { useEffect, useRef } from 'react'; // useEffect kept for loadSpaces/loadSettings/loadSystemInfo
import { Header } from '@/components/layout/Header';
import { SpaceTabs } from '@/components/layout/SpaceTabs';
import { Board } from '@/components/board/Board';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { ConfigPanel } from '@/components/config/ConfigPanel';
import { RunsPanel } from '@/components/runs-panel/RunsPanel';
import { AgentPromptPreview } from '@/components/agent-launcher/AgentPromptPreview';
import { TaskDetailPanel } from '@/components/board/TaskDetailPanel';
import { CreateTaskModal } from '@/components/modals/CreateTaskModal';
import { AttachmentModal } from '@/components/modals/AttachmentModal';
import { MarkdownModal } from '@/components/modals/MarkdownModal';
import { SpaceModal } from '@/components/modals/SpaceModal';
import { DeleteSpaceDialog } from '@/components/modals/DeleteSpaceDialog';
import { PipelineConfirmModal } from '@/components/modals/PipelineConfirmModal';
import { TaggerReviewModal } from '@/components/modals/TaggerReviewModal';
import { GlobalSearchModal } from '@/components/modals/GlobalSearchModal';
import { AutoTaskFAB } from '@/components/AutoTaskFAB';
import { AutoTaskModal } from '@/components/AutoTaskModal';
import { FolioScreen } from '@/components/folio/FolioScreen';
import { Toast } from '@/components/shared/Toast';
import { useAppStore } from '@/stores/useAppStore';
import { usePolling } from '@/hooks/usePolling';
import { useAgentCompletion } from '@/hooks/useAgentCompletion';
import { useRunHistoryPolling } from '@/hooks/useRunHistoryPolling';
import { usePipelineLogStore } from '@/stores/usePipelineLogStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';

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

/**
 * On mobile (<640px) the side panels render as full-screen overlays (see the
 * `.panel-shell` rule in index.css), so two open at once would stack and
 * obscure each other. This enforces one-open-at-a-time: when a panel opens on
 * a narrow screen, the others close. On desktop panels coexist side by side, so
 * this is a no-op. Coordinating here (vs in each store action) keeps the three
 * panel stores decoupled — no cross-store imports / circular deps.
 */
function useMobilePanelExclusivity() {
  const folioOpen  = useAppStore((s) => s.folioOpen);
  const configOpen = useAppStore((s) => s.configPanelOpen);
  const runsOpen   = usePipelineLogStore((s) => s.runsPanelOpen);
  const termOpen   = useTerminalSessionStore((s) => s.panelOpen);
  const prev = useRef({ folioOpen, configOpen, runsOpen, termOpen });

  useEffect(() => {
    const p = prev.current;
    if (window.matchMedia('(max-width: 639px)').matches) {
      // Identify the panel that just transitioned closed → open, then close the rest.
      const opened =
        folioOpen  && !p.folioOpen  ? 'folio'  :
        configOpen && !p.configOpen ? 'config' :
        runsOpen   && !p.runsOpen   ? 'runs'   :
        termOpen   && !p.termOpen   ? 'term'   : null;
      if (opened) {
        const app  = useAppStore.getState();
        const plog = usePipelineLogStore.getState();
        const term = useTerminalSessionStore.getState();
        if (opened !== 'folio'  && app.folioOpen)              app.closeFolio();
        if (opened !== 'config' && app.configPanelOpen)        app.setConfigPanelOpen(false);
        if (opened !== 'runs'   && plog.runsPanelOpen)         plog.setRunsPanelOpen(false);
        if (opened !== 'term'   && term.panelOpen)             term.closePanel();
      }
    }
    prev.current = { folioOpen, configOpen, runsOpen, termOpen };
  }, [folioOpen, configOpen, runsOpen, termOpen]);
}

function AppContent() {
  const loadSpaces           = useAppStore((s) => s.loadSpaces);
  const loadSettings         = useAppStore((s) => s.loadSettings);
  const loadSystemInfo       = useAppStore((s) => s.loadSystemInfo);
  const configPanelOpen        = useAppStore((s) => s.configPanelOpen);
  const folioOpen              = useAppStore((s) => s.folioOpen);
  const closeFolio             = useAppStore((s) => s.closeFolio);
  const runsPanelOpen          = usePipelineLogStore((s) => s.runsPanelOpen);
  const isGlobalSearchOpen     = useAppStore((s) => s.isGlobalSearchOpen);
  const openGlobalSearch       = useAppStore((s) => s.openGlobalSearch);
  const closeGlobalSearch      = useAppStore((s) => s.closeGlobalSearch);

  const [autoTaskModalOpen, setAutoTaskModalOpen] = React.useState(false);

  useEffect(() => {
    loadSpaces();
    loadSettings();
    loadSystemInfo();
  }, [loadSpaces, loadSettings, loadSystemInfo]);

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

  usePolling(); // includes external-run detection on each idle tick
  useAgentCompletion();
  useRunHistoryPolling(); // polls /api/v1/agent-runs for the Runs panel
  useMobilePanelExclusivity(); // mobile: one side panel open at a time

  return (
    <div className="flex flex-col h-full">
      <Header />

      <div className="flex-1 overflow-hidden flex flex-col">
        <SpaceTabs />
        {/* Board + optional side panels (TerminalPanel, ConfigPanel) in a flex row.
            Board uses flex-1 so it shrinks gracefully when panels are open.
            Layout order: Board | TerminalPanel | ConfigPanel (ADR-1 §5.1). */}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-hidden relative transition-all duration-300 ease-out">
            <Board />
            <AutoTaskFAB onClick={() => setAutoTaskModalOpen(true)} />
          </div>
          <TerminalPanel />
          {runsPanelOpen && <RunsPanel />}
          {configPanelOpen && <ConfigPanel />}
          {folioOpen && <FolioScreen onClose={closeFolio} />}
        </div>
      </div>

      {/* Task detail panel — z-50, above board (z-0/10), below modals (z-60+).
          Rendered at App root so it overlays the full viewport without being
          inside any scrollable column container. ADR-1 (task-detail-edit) §3.4. */}
      <TaskDetailPanel />

      <AgentPromptPreview />
      <CreateTaskModal />
      <AttachmentModal />
      <MarkdownModal />
      <SpaceModal />
      <DeleteSpaceDialog />
      <PipelineConfirmModal />
      <TaggerReviewModal />
      <GlobalSearchModal open={isGlobalSearchOpen} onClose={closeGlobalSearch} />
      <AutoTaskModal
        open={autoTaskModalOpen}
        onClose={() => {
          setAutoTaskModalOpen(false);
          // Restore focus to FAB after modal closes (accessibility)
          setTimeout(() => {
            const fab = document.querySelector<HTMLElement>('[data-autotask-fab]');
            fab?.focus();
          }, 200);
        }}
      />

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
