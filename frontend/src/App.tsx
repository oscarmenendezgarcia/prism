/**
 * Top-level application component.
 * Renders the Kanban board directly — no routing needed.
 *
 * Layout:
 *   Header (sticky)
 *   SpaceTabs + Board + optional TerminalPanel + optional ConfigPanel
 *   Portals: modals + Toast
 */

import React, { useEffect } from 'react'; // useEffect kept for loadSpaces/loadSettings/loadSystemInfo
import { Header } from '@/components/layout/Header';
import { SpaceTabs } from '@/components/layout/SpaceTabs';
import { Board } from '@/components/board/Board';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { ConfigPanel } from '@/components/config/ConfigPanel';
import { AgentSettingsPanel } from '@/components/agent-launcher/AgentSettingsPanel';
import { RunHistoryPanel } from '@/components/agent-run-history/RunHistoryPanel';
import { PipelineLogPanel } from '@/components/pipeline-log/PipelineLogPanel';
import { AgentPromptPreview } from '@/components/agent-launcher/AgentPromptPreview';
import { TaskDetailPanel } from '@/components/board/TaskDetailPanel';
import { CreateTaskModal } from '@/components/modals/CreateTaskModal';
import { AttachmentModal } from '@/components/modals/AttachmentModal';
import { MarkdownModal } from '@/components/modals/MarkdownModal';
import { SpaceModal } from '@/components/modals/SpaceModal';
import { DeleteSpaceDialog } from '@/components/modals/DeleteSpaceDialog';
import { PipelineConfirmModal } from '@/components/modals/PipelineConfirmModal';
import { TaggerReviewModal } from '@/components/modals/TaggerReviewModal';
import { AutoTaskFAB } from '@/components/AutoTaskFAB';
import { AutoTaskModal } from '@/components/AutoTaskModal';
import { Toast } from '@/components/shared/Toast';
import { useAppStore } from '@/stores/useAppStore';
import { usePolling } from '@/hooks/usePolling';
import { useAgentCompletion } from '@/hooks/useAgentCompletion';
import { useRunHistoryPolling } from '@/hooks/useRunHistoryPolling';
import { useRunHistoryStore } from '@/stores/useRunHistoryStore';
import { usePipelineLogStore } from '@/stores/usePipelineLogStore';

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
  const loadSettings         = useAppStore((s) => s.loadSettings);
  const loadSystemInfo       = useAppStore((s) => s.loadSystemInfo);
  const configPanelOpen        = useAppStore((s) => s.configPanelOpen);
  const agentSettingsPanelOpen = useAppStore((s) => s.agentSettingsPanelOpen);
  const pipelineState          = useAppStore((s) => s.pipelineState);
  const historyPanelOpen       = useRunHistoryStore((s) => s.historyPanelOpen);
  const logPanelOpen           = usePipelineLogStore((s) => s.logPanelOpen);

  const [autoTaskModalOpen, setAutoTaskModalOpen] = React.useState(false);

  useEffect(() => {
    loadSpaces();
    loadSettings();
    loadSystemInfo();
  }, [loadSpaces, loadSettings, loadSystemInfo]);

  usePolling(); // includes external-run detection on each idle tick
  useAgentCompletion();
  useRunHistoryPolling();

  return (
    <div className="flex flex-col h-full">
      <Header />

      <div className="flex-1 overflow-hidden flex flex-col">
        <SpaceTabs />
        {/* Board + optional side panels (TerminalPanel, ConfigPanel) in a flex row.
            Board uses flex-1 so it shrinks gracefully when panels are open.
            Layout order: Board | TerminalPanel | ConfigPanel (ADR-1 §5.1). */}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-hidden relative">
            <Board />
            <AutoTaskFAB onClick={() => setAutoTaskModalOpen(true)} />
          </div>
          <TerminalPanel />
          {historyPanelOpen && <RunHistoryPanel />}
          {logPanelOpen && pipelineState !== null && <PipelineLogPanel />}
          {configPanelOpen && <ConfigPanel />}
          {agentSettingsPanelOpen && <AgentSettingsPanel />}
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
