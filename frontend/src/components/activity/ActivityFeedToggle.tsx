/**
 * ActivityFeedToggle — header icon button that opens/closes the ActivityFeedPanel.
 *
 * ADR-1 (Activity Feed): toggle follows the same pattern as TerminalToggle and ConfigToggle.
 *
 * Displays a notification badge with the unread count when:
 *   - The panel is closed, AND
 *   - activityUnreadCount > 0
 *
 * Opening the panel via this button automatically clears the unread count
 * (handled inside setActivityPanelOpen in the store).
 */

import React from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { useActivityPanelOpen, useActivityUnreadCount } from '@/stores/useAppStore';

/** Cap the badge display at 99+. */
function formatBadgeCount(n: number): string {
  return n > 99 ? '99+' : String(n);
}

export function ActivityFeedToggle() {
  const panelOpen      = useActivityPanelOpen();
  const unreadCount    = useActivityUnreadCount();
  const togglePanel    = useAppStore((s) => s.toggleActivityPanel);

  const showBadge = !panelOpen && unreadCount > 0;

  return (
    <button
      onClick={togglePanel}
      aria-label={`Toggle activity feed${showBadge ? `, ${unreadCount} unread` : ''}`}
      aria-pressed={panelOpen}
      className={`relative w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-150 ease-apple ${
        panelOpen
          ? 'bg-primary/[0.15] text-primary'
          : 'text-text-secondary hover:bg-surface-variant hover:text-text-primary'
      }`}
    >
      <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
        notifications
      </span>

      {showBadge && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 flex items-center justify-center rounded-full bg-error text-white text-[10px] font-semibold leading-none"
        >
          {formatBadgeCount(unreadCount)}
        </span>
      )}
    </button>
  );
}
