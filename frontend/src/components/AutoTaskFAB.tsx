/**
 * Auto-task FAB — fixed pill button at bottom-right of the board.
 *
 * Visual design:
 *   - Pill shape (border-radius 9999px), 48px tall, backdrop blur glass
 *   - Animated conic-gradient border via ::before pseudo-element (CSS class
 *     .autotask-fab in index.css — Tailwind cannot express @property + conic)
 *   - Icon: Material Symbol "auto_awesome" (sparkle)
 *   - Label hidden on mobile (<600px) via .autotask-fab__label CSS class
 *
 * Accessibility:
 *   - aria-label describes the full action
 *   - data-autotask-fab for programmatic focus restoration after modal closes
 *   - Keyboard: Enter/Space (native button), focus-visible ring
 *   - prefers-reduced-motion: animation paused via CSS media query
 */

import React from 'react';

interface AutoTaskFABProps {
  onClick: () => void;
}

export function AutoTaskFAB({ onClick }: AutoTaskFABProps) {
  return (
    <button
      type="button"
      className="autotask-fab"
      onClick={onClick}
      aria-label="AI Actions: generate tasks or auto-tag"
      data-autotask-fab
    >
      <span
        className="material-symbols-outlined icon-filled text-[20px] leading-none"
        aria-hidden="true"
      >
        auto_awesome
      </span>
      <span className="autotask-fab__label">AI Actions</span>
    </button>
  );
}
