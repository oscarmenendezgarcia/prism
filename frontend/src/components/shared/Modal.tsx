import React, { useEffect, useRef, useState, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

const ModalCloseContext = createContext<(() => void) | null>(null);

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  labelId?: string;
  children: React.ReactNode;
  className?: string;
  role?: 'dialog' | 'alertdialog';
  /** Override enter/exit animation classes on the content box. */
  enterAnimation?: string;
  exitAnimation?: string;
}

export function Modal({
  open,
  onClose,
  title,
  labelId,
  children,
  className = '',
  role = 'dialog',
  enterAnimation = 'animate-scale-in',
  exitAnimation = 'animate-modal-out',
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(open);

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

  // Prevent background scroll while modal is open.
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Save + restore focus.
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [open]);

  // Escape key.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus trap.
  useEffect(() => {
    if (!open || !overlayRef.current) return;
    const focusable = overlayRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) focusable[0].focus();

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !overlayRef.current) return;
      const list = Array.from(overlayRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [open]);

  function handleClose() {
    setIsClosing(true);
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
        className={`fixed inset-0 z-[150] flex items-center justify-center bg-black/40 backdrop-blur-[40px] backdrop-saturate-[200%] ${isClosing ? 'animate-backdrop-out' : 'animate-backdrop-in'}`}
        role={role}
        aria-modal="true"
        aria-labelledby={labelId}
        aria-hidden={!open}
        onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
      >
        <div
          className={`bg-surface glass-heavy border border-border rounded-modal shadow-modal w-full max-w-lg mx-4 flex flex-col ${isClosing ? exitAnimation : enterAnimation} ${className}`}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </ModalCloseContext.Provider>,
    document.body
  );
}

export function ModalHeader({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
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

export function ModalTitle({ id, children, className = '' }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <h2 id={id} className={`text-base font-semibold text-text-primary tracking-tight${className ? ` ${className}` : ''}`}>
      {children}
    </h2>
  );
}

export function ModalBody({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-6 py-4 overflow-y-auto max-h-[calc(90vh-9rem)] ${className}`}>{children}</div>;
}

export function ModalFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
      {children}
    </div>
  );
}
