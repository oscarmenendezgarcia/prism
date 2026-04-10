/**
 * Toast notification — renders via createPortal at the bottom of the screen.
 * Auto-hides after 3 seconds (managed by the store's showToast action).
 * ADR-002: replaces the #toast DOM element + showToast() in legacy app.js.
 * ADR-003 §8.9: glass-surface, rounded-lg, shadow-lg, animate-slide-in-bottom.
 */

/**
 * Toast notification — renders via createPortal at the bottom of the screen.
 * Auto-hides after 3 seconds (managed by the store's showToast action).
 * T-1: applies animate-toast-out when toastLeaving is true (200ms before unmount).
 * ADR-002: replaces the #toast DOM element + showToast() in legacy app.js.
 * ADR-003 §8.9: glass-surface, rounded-lg, shadow-lg, animate-slide-in-bottom.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { useToast, useToastLeaving } from '@/stores/useAppStore';

export function Toast() {
  const toast = useToast();
  const leaving = useToastLeaving();

  if (!toast) return null;

  const isError = toast.type === 'error';
  const isInfo  = toast.type === 'info';

  return createPortal(
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      data-leaving={leaving}
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] px-5 py-3 rounded-lg text-white text-sm font-medium shadow-xl transition-all flex items-center gap-3 ${
        isError ? 'bg-error' : isInfo ? 'bg-primary' : 'bg-success'
      } ${leaving ? 'animate-toast-out' : 'animate-slide-in-bottom'}`}
    >
      <span>{toast.message}</span>
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
