/**
 * Top-level application component.
 * Renders the Kanban board directly — no routing needed.
 *
 * Layout:
 *   Header (sticky)
 *   SpaceTabs + Board + optional panels (Terminal, Config, AgentSettings, ActivityFeed)
 *   Portals: modals + Toast
 */

import React, { useEffect } from 'react';
import { Header } from '@/components/layout/Header';
import { SpaceTabs } from '@/components/layout/SpaceTabs';
import { Board } from '@/components/board/Board';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { ConfigPanel } from '@/components/config/ConfigPanel';
import { AgentSettingsPanel } from '@/components/agent-launcher/AgentSettingsPanel';
import { AgentPromptPreview } from '@/components/agent-launcher/AgentPromptPreview';
import { ActivityFeedPanel } from '@/components/activity/ActivityFeedPanel';
import { CreateTaskModal } from '@/components/modals/CreateTaskModal';
import { AttachmentModal } from '@/components/modals/AttachmentModal';
import { MarkdownModal } from '@/components/modals/MarkdownModal';
import { SpaceModal } from '@/components/modals/SpaceModal';
import { DeleteSpaceDialog } from '@/components/modals/DeleteSpaceDialog';
import { Toast } from '@/components/shared/Toast';
import { useAppStore } from '@/stores/useAppStore';
import { usePolling } from '@/hooks/usePolling';
import { useAgentCompletion } from '@/hooks/useAgentCompletion';
import { useActivityFeed } from '@/hooks/useActivityFeed';

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
  const loadSpaces             = useAppStore((s) => s.loadSpaces);
  const loadSettings           = useAppStore((s) => s.loadSettings);
  const terminalOpen           = useAppStore((s) => s.terminalOpen);
  const configPanelOpen        = useAppStore((s) => s.configPanelOpen);
  const agentSettingsPanelOpen = useAppStore((s) => s.agentSettingsPanelOpen);
  const activityPanelOpen      = useAppStore((s) => s.activityPanelOpen);

  useEffect(() => {
    loadSpaces();
    loadSettings();
  }, [loadSpaces, loadSettings]);

  usePolling();
  useAgentCompletion();

  // Mount the activity feed WebSocket regardless of panel visibility so events
  // accumulate in the store even when the panel is closed (ADR-1 Activity Feed §T-016).
  const { status: activityStatus } = useActivityFeed();

  return (
    <div className="flex flex-col h-full">
      <Header />

      <div className="flex-1 overflow-hidden flex flex-col">
        <SpaceTabs />
        {/* Board + optional side panels in a flex row.
            Board uses flex-1 so it shrinks gracefully when panels are open.
            Layout order: Board | TerminalPanel | ConfigPanel | AgentSettingsPanel | ActivityFeedPanel */}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <Board />
          </div>
          {terminalOpen && <TerminalPanel />}
          {configPanelOpen && <ConfigPanel />}
          {agentSettingsPanelOpen && <AgentSettingsPanel />}
          {activityPanelOpen && <ActivityFeedPanel status={activityStatus} />}
        </div>
      </div>

      <AgentPromptPreview />
      <CreateTaskModal />
      <AttachmentModal />
      <MarkdownModal />
      <SpaceModal />
      <DeleteSpaceDialog />

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
