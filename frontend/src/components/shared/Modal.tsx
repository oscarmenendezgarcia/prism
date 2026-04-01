/**
 * Generic modal overlay with backdrop, Escape key handler, aria attributes,
 * and focus trap. Renders via createPortal to document.body.
 * ADR-002 §5 rule 4: modals use portals.
 * ADR-003 §8.7: bg-black/40 glass-heavy overlay, glass-heavy container, animate-scale-in.
 */

import React, { useEffect, useRef, useState, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

/** Provides the animated-close handler to sub-components (ModalHeader ×). */
const ModalCloseContext = createContext<(() => void) | null>(null);

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  labelId?: string;
  children: React.ReactNode;
  /** Extra classes for the modal container (not the overlay). */
  className?: string;
  /** Role — use 'alertdialog' for destructive confirmations. */
  role?: 'dialog' | 'alertdialog';
}

export function Modal({
  open,
  onClose,
  title,
  labelId,
  children,
  className = '',
  role = 'dialog',
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  // M-1: track closing state to play exit animation before unmount
  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(open);

  // Sync visibility with open prop; entering resets closing state.
  // BUG-001: when open transitions to false externally (e.g. after task creation),
  // play the exit animation then unmount — otherwise isVisible stays true forever.
  useEffect(() => {
    if (open) {
      setIsVisible(true);
      setIsClosing(false);
    } else {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setIsClosing(false);
        setIsVisible(false);
      }, 180);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Save + restore focus
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [open]);

  // Escape key — trigger animated close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Trap focus within modal
  useEffect(() => {
    if (!open || !overlayRef.current) return;
    const focusable = overlayRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) {
      focusable[0].focus();
    }

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !overlayRef.current) return;
      const focusableList = Array.from(
        overlayRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusableList.length === 0) return;
      const first = focusableList[0];
      const last = focusableList[focusableList.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [open]);

  // M-1: animated close — play modal-out, then call parent onClose
  function handleClose() {
    setIsClosing(true);
    // 180ms matches animate-modal-out duration
    setTimeout(() => {
      setIsClosing(false);
      setIsVisible(false);
      onClose();
    }, 180);
  }

  if (!isVisible && !open) return null;

  return createPortal(
    <ModalCloseContext.Provider value={handleClose}>
      <div
        ref={overlayRef}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[40px] backdrop-saturate-[200%]"
        role={role}
        aria-modal="true"
        aria-labelledby={labelId}
        aria-hidden={!open}
        onClick={(e) => {
          if (e.target === e.currentTarget) handleClose();
        }}
      >
        <div
          className={`bg-surface glass-heavy border border-border rounded-modal shadow-modal w-full max-w-lg mx-4 flex flex-col max-h-[90vh] ${isClosing ? 'animate-modal-out' : 'animate-scale-in'} ${className}`}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </ModalCloseContext.Provider>,
    document.body
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

export function ModalHeader({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose?: () => void;
}) {
  // Prefer the animated close from Modal context; fall back to raw prop
  const animatedClose = useContext(ModalCloseContext);
  const handleClose = animatedClose ?? onClose;

  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-border">
      <div className="flex-1">{children}</div>
      {handleClose && (
        <button
          onClick={handleClose}
          aria-label="Close modal"
          className="ml-3 w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-variant hover:text-text-primary transition-all duration-150 ease-apple text-xl leading-none"
        >
          &times;
        </button>
      )}
    </div>
  );
}

export function ModalTitle({
  id,
  children,
}: {
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <h2 id={id} className="text-base font-semibold text-text-primary tracking-tight">
      {children}
    </h2>
  );
}

export function ModalBody({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-6 py-4 overflow-y-auto flex-1 ${className}`}>{children}</div>;
}

export function ModalFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
      {children}
    </div>
  );
}
