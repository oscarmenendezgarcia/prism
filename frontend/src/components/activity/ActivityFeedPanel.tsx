/**
 * ActivityFeedPanel — resizable sidebar panel showing real-time kanban activity events.
 *
 * ADR-1 (Activity Feed): sidebar rendered alongside Board, TerminalPanel, ConfigPanel.
 *
 * Features:
 * - Drag-to-resize left edge via usePanelResize (same pattern as TerminalPanel).
 * - Header: title, WebSocket status dot, close button.
 * - Event type filter dropdown.
 * - Scrollable event list with icon, description, and relative timestamp per event.
 * - Empty state when no events match the current filter.
 * - "Load more" button for paginated history.
 *
 * Design system: Tailwind CSS tokens only (bg-surface, text-text-primary, etc.).
 * Dark theme is the default; all token values flip automatically via html.dark.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { usePanelResize } from '@/hooks/usePanelResize';
import type { ActivityEvent, ActivityEventType, ActivityStatus } from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENT_TYPE_OPTIONS: Array<{ value: ActivityEventType | ''; label: string }> = [
  { value: '',                  label: 'All events' },
  { value: 'task.created',      label: 'Task created' },
  { value: 'task.moved',        label: 'Task moved' },
  { value: 'task.updated',      label: 'Task updated' },
  { value: 'task.deleted',      label: 'Task deleted' },
  { value: 'space.created',     label: 'Space created' },
  { value: 'space.renamed',     label: 'Space renamed' },
  { value: 'space.deleted',     label: 'Space deleted' },
  { value: 'board.cleared',     label: 'Board cleared' },
];

/** Material Symbols icon name per event type. */
const EVENT_ICON: Record<ActivityEventType, string> = {
  'task.created':  'add_task',
  'task.moved':    'move_item',
  'task.updated':  'edit_note',
  'task.deleted':  'delete',
  'space.created': 'add',
  'space.renamed': 'drive_file_rename_outline',
  'space.deleted': 'folder_delete',
  'board.cleared': 'clear_all',
};

/** Tailwind text-color class per event type. */
const EVENT_ICON_COLOR: Record<ActivityEventType, string> = {
  'task.created':  'text-success',
  'task.moved':    'text-info',
  'task.updated':  'text-warning',
  'task.deleted':  'text-error',
  'space.created': 'text-success',
  'space.renamed': 'text-info',
  'space.deleted': 'text-error',
  'board.cleared': 'text-error',
};

const STATUS_DOT: Record<ActivityStatus, string> = {
  connected:    'bg-success',
  connecting:   'bg-warning',
  disconnected: 'bg-error',
};

const STATUS_LABEL: Record<ActivityStatus, string> = {
  connected:    'Live',
  connecting:   'Connecting…',
  disconnected: 'Disconnected',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a human-readable summary of an activity event.
 * Used as the primary text line in each event card.
 */
function describeEvent(event: ActivityEvent): string {
  const { type, payload } = event;
  switch (type) {
    case 'task.created':
      return `Task "${payload.taskTitle ?? payload.taskId}" created`;
    case 'task.moved':
      return `Task "${payload.taskTitle ?? payload.taskId}" moved ${payload.from} → ${payload.to}`;
    case 'task.updated': {
      const fields = payload.fields?.join(', ') ?? 'fields';
      return `Task "${payload.taskTitle ?? payload.taskId}" updated (${fields})`;
    }
    case 'task.deleted':
      return `Task "${payload.taskTitle ?? payload.taskId}" deleted`;
    case 'space.created':
      return `Space "${payload.spaceName}" created`;
    case 'space.renamed':
      return `Space renamed to "${payload.spaceName}"`;
    case 'space.deleted':
      return `Space "${payload.spaceName}" deleted`;
    case 'board.cleared':
      return `Board cleared (${payload.deletedCount ?? 0} tasks removed)`;
    default:
      return type;
  }
}

/**
 * Convert an ISO-8601 timestamp to a short relative string, e.g. "just now", "3m ago".
 * Recalculated on render — no live clock; acceptable for activity feed use.
 */
function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  if (diffMs < 0)          return 'just now';
  if (diffMs < 60_000)     return 'just now';
  if (diffMs < 3_600_000)  return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface EventCardProps {
  event: ActivityEvent;
}

function EventCard({ event }: EventCardProps) {
  const icon      = EVENT_ICON[event.type]       ?? 'info';
  const iconColor = EVENT_ICON_COLOR[event.type] ?? 'text-text-secondary';

  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 border-b border-border/50 last:border-b-0 hover:bg-surface-elevated/40 transition-colors duration-100">
      <span
        className={`material-symbols-outlined text-[18px] leading-none mt-0.5 shrink-0 ${iconColor}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-text-primary leading-snug truncate" title={describeEvent(event)}>
          {describeEvent(event)}
        </p>
        <p className="text-[11px] text-text-secondary mt-0.5">{relativeTime(event.timestamp)}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ActivityFeedPanelProps {
  /** Current WebSocket connection status — passed in from App.tsx / useActivityFeed. */
  status: ActivityStatus;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * ActivityFeedPanel — always mounted in AppContent, conditionally visible.
 * Width is drag-resizable (persisted in localStorage). Events are sourced from
 * the Zustand store slice populated by the useActivityFeed hook.
 */
export function ActivityFeedPanel({ status }: ActivityFeedPanelProps) {
  const events              = useAppStore((s) => s.activityEvents);
  const filter              = useAppStore((s) => s.activityFilter);
  const loading             = useAppStore((s) => s.activityLoading);
  const nextCursor          = useAppStore((s) => s.activityNextCursor);
  const setActivityPanelOpen = useAppStore((s) => s.setActivityPanelOpen);
  const setActivityFilter   = useAppStore((s) => s.setActivityFilter);
  const loadActivityHistory = useAppStore((s) => s.loadActivityHistory);

  const { width, handleMouseDown, minWidth, maxWidth } = usePanelResize({
    storageKey:   'prism:panel-width:activity',
    defaultWidth: 360,
    minWidth:     280,
    maxWidth:     600,
  });

  // ---------------------------------------------------------------------------
  // Auto-scroll to newest event when at the bottom of the list
  // ---------------------------------------------------------------------------

  const listRef       = useRef<HTMLDivElement>(null);
  const atBottomRef   = useRef(true);
  const prevLenRef    = useRef(events.length);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    // Consider "at bottom" when within 40px of the bottom edge.
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  useEffect(() => {
    // Only scroll if new events were prepended (list grew) and user is at bottom.
    if (events.length !== prevLenRef.current && atBottomRef.current) {
      listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
    prevLenRef.current = events.length;
  }, [events.length]);

  // ---------------------------------------------------------------------------
  // Filtered view
  // ---------------------------------------------------------------------------

  const filteredEvents = filter.type
    ? events.filter((e) => e.type === filter.type)
    : events;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <aside
      className="relative flex flex-col bg-surface border-l border-border h-full shrink-0 w-[var(--panel-w)]"
      style={{ '--panel-w': `${width}px` } as React.CSSProperties}
      aria-label="Activity feed"
    >
      {/* Left-edge drag handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize activity panel"
        aria-valuenow={width}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        onMouseDown={handleMouseDown}
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/40 transition-colors duration-150 z-10"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold text-text-primary">Activity</span>
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
            <span className="text-xs text-text-secondary">{STATUS_LABEL[status]}</span>
          </div>
        </div>
        <button
          onClick={() => setActivityPanelOpen(false)}
          aria-label="Close activity panel"
          className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors duration-150"
        >
          <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
            close
          </span>
        </button>
      </div>

      {/* Filter bar */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <select
          value={filter.type ?? ''}
          onChange={(e) => {
            const val = e.target.value as ActivityEventType | '';
            setActivityFilter({ type: val || undefined });
          }}
          aria-label="Filter by event type"
          className="w-full text-xs bg-surface-elevated border border-border rounded-xs px-2 py-1.5 text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer"
        >
          {EVENT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Event list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0"
      >
        {filteredEvents.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
            <span
              className="material-symbols-outlined text-3xl text-text-disabled"
              aria-hidden="true"
            >
              history
            </span>
            <p className="text-sm text-text-secondary">No activity yet</p>
            <p className="text-xs text-text-disabled">
              {filter.type
                ? 'Try clearing the filter to see all events.'
                : 'Events will appear here as tasks and spaces change.'}
            </p>
          </div>
        ) : (
          filteredEvents.map((event) => (
            <EventCard key={event.id} event={event} />
          ))
        )}
      </div>

      {/* Load more — hidden once all pages are exhausted (nextCursor is null after first fetch) */}
      {(events.length === 0 || nextCursor !== null) && (
        <div className="px-3 py-2 border-t border-border shrink-0">
          <button
            onClick={() => loadActivityHistory(nextCursor ?? undefined)}
            disabled={loading}
            className="w-full text-xs text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed py-1 transition-colors duration-150"
            aria-label="Load more activity history"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-1.5">
                <span
                  className="material-symbols-outlined text-sm leading-none animate-spin"
                  aria-hidden="true"
                >
                  progress_activity
                </span>
                Loading…
              </span>
            ) : (
              'Load more'
            )}
          </button>
        </div>
      )}
    </aside>
  );
}
