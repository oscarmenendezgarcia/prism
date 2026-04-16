/**
 * Toast notification — renders via createPortal at the bottom of the screen.
 * Auto-hides after 3 seconds (managed by the store's showToast action).
 * ADR-002: replaces the #toast DOM element + showToast() in legacy app.js.
 * Redesign (Trend A): semantic container colors, Material icon prefix, slide-up animation.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { useToast, useToastLeaving } from '@/stores/useAppStore';

const TOAST_CONFIG = {
  success: {
    bgClass:   'bg-success',
    iconClass: 'text-white',
    icon:      'check_circle',
    role:      'status' as const,
    ariaLive:  'polite' as const,
  },
  error: {
    bgClass:   'bg-error',
    iconClass: 'text-white',
    icon:      'cancel',
    role:      'alert' as const,
    ariaLive:  'assertive' as const,
  },
  info: {
    bgClass:   'bg-primary',
    iconClass: 'text-white',
    icon:      'info',
    role:      'status' as const,
    ariaLive:  'polite' as const,
  },
} as const;

export function Toast() {
  const toast   = useToast();
  const leaving = useToastLeaving();

  if (!toast) return null;

  const config = TOAST_CONFIG[toast.type ?? 'success'];

  return createPortal(
    <div
      role={config.role}
      aria-live={config.ariaLive}
      data-leaving={leaving}
      className={`fixed bottom-6 left-1/2 z-[200] flex items-center gap-3 px-4 py-3 rounded-lg text-white text-sm font-medium shadow-xl max-w-[400px] ${
        config.bgClass
      } ${leaving ? 'animate-toast-out' : 'animate-toast-in'}`}
    >
      <span
        className={`material-symbols-outlined text-lg leading-none flex-shrink-0 icon-filled ${config.iconClass}`}
        aria-hidden="true"
      >
        {config.icon}
      </span>
      <span className="flex-1">{toast.message}</span>
      {toast.action && (
        <button
          onClick={toast.action.onClick}
          className="shrink-0 px-2.5 py-1 rounded bg-white/20 hover:bg-white/30 transition-colors text-xs font-semibold"
        >
          {toast.action.label}
        </button>
      )}
    </div>,
    document.body
  );
}
