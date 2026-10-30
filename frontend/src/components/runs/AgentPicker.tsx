/**
 * Chooses the harness and model that new runs use. The harnesses that are not
 * installed stay visible, with a link to install them.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTaskRunStore } from '@/stores/useTaskRunStore';
import type { AgentChoice } from '@/types';
import { HarnessIcon, HARNESS_NAMES, type DirectCliTool } from './HarnessIcon';

const HARNESS_ORDER: DirectCliTool[] = ['claude', 'opencode', 'pi', 'hermes'];
const CLAUDE_MODELS = [
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus',   label: 'Opus' },
  { value: 'haiku',  label: 'Haiku' },
];

export function choiceLabel(choice: AgentChoice): string {
  const name = HARNESS_NAMES[choice.cliTool as DirectCliTool] ?? choice.cliTool;
  if (choice.cliTool === 'claude') {
    return CLAUDE_MODELS.find((m) => m.value === choice.model)?.label ?? 'Claude Code';
  }
  return choice.model ? choice.model.split('/').pop() as string : name;
}

export function AgentPicker({ compact = false }: { compact?: boolean }) {
  const choice    = useTaskRunStore((s) => s.choice);
  const setChoice = useTaskRunStore((s) => s.setChoice);

  const harnesses = useTaskRunStore((s) => s.harnesses);

  const [open, setOpen]         = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    // Something may have been installed since the page loaded.
    void useTaskRunStore.getState().loadHarnesses();
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!popoverRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
      // It lives outside the page's tab order, and outside the detail panel's focus trap.
      if (e.key === 'Tab' && popoverRef.current) {
        const items = [...popoverRef.current.querySelectorAll<HTMLElement>('a[href], button, input')];
        const at = items.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const height = popoverRef.current?.offsetHeight ?? 0;
    const below = rect.bottom + 4;
    setPosition({
      left: Math.min(rect.left, window.innerWidth - 272),
      top:  below + height > window.innerHeight ? Math.max(8, rect.top - height - 4) : below,
    });
  }, [open, harnesses, choice.cliTool]);

  // It stays invisible, and so not focusable, until it has a position.
  const placed = position !== null;
  useEffect(() => {
    if (open && placed) popoverRef.current?.querySelector<HTMLElement>('[aria-pressed="true"], button, a[href]')?.focus();
  }, [open, placed]);

  const select = (cliTool: DirectCliTool) => {
    if (cliTool !== choice.cliTool) setChoice(cliTool === 'claude' ? { cliTool, model: 'sonnet' } : { cliTool });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Agent: ${HARNESS_NAMES[choice.cliTool as DirectCliTool] ?? choice.cliTool}. Change`}
        data-testid="agent-picker"
        className="inline-flex items-center gap-1.5 h-8 px-2 min-w-0 rounded-lg text-xs text-text-secondary hover:bg-surface-variant focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary transition-colors duration-fast"
      >
        <HarnessIcon cliTool={choice.cliTool} />
        <span className={compact ? 'hidden [@media(pointer:coarse)]:inline truncate' : 'truncate'}>{choiceLabel(choice)}</span>
        <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">expand_more</span>
      </button>

      {open && createPortal(
        // The card behind must not receive these clicks, and React bubbles through portals.
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Choose agent"
          onClick={(e) => e.stopPropagation()}
          data-testid="agent-picker-menu"
          // EXCEPTION: viewport coordinates computed at runtime, same as the app's context menu.
          style={position ?? undefined}
          className={`fixed z-[200] w-[264px] p-1.5 rounded-lg bg-surface-elevated border border-border shadow-xl ${position ? '' : 'invisible'}`}
        >
          {HARNESS_ORDER.map((cliTool) => {
            const info = harnesses?.find((h) => h.cliTool === cliTool);
            const missing = info ? !info.available : false;
            const selected = choice.cliTool === cliTool;
            return (
              <div key={cliTool}>
                {missing ? (
                  <a
                    href={info?.installUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-text-secondary hover:bg-surface-variant"
                  >
                    <HarnessIcon cliTool={cliTool} className="w-4 h-4 opacity-50" />
                    <span className="flex-1">{HARNESS_NAMES[cliTool]}</span>
                    <span className="text-xs">Install</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => select(cliTool)}
                    aria-pressed={selected}
                    className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${selected ? 'bg-primary/[0.12] text-text-primary' : 'text-text-secondary hover:bg-surface-variant'}`}
                  >
                    <HarnessIcon cliTool={cliTool} />
                    <span className="flex-1">{HARNESS_NAMES[cliTool]}</span>
                    {selected && <span className="material-symbols-outlined text-sm leading-none text-primary" aria-hidden="true">check</span>}
                  </button>
                )}
                {selected && cliTool === 'claude' && (
                  <div className="flex gap-1 px-2 py-1.5" role="group" aria-label="Model">
                    {CLAUDE_MODELS.map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        aria-pressed={(choice.model ?? 'sonnet') === m.value}
                        onClick={() => setChoice({ cliTool: 'claude', model: m.value })}
                        className={`flex-1 h-7 rounded-md text-xs focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${(choice.model ?? 'sonnet') === m.value ? 'bg-primary text-on-primary' : 'bg-surface-variant text-text-secondary hover:text-text-primary'}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
                {selected && cliTool !== 'claude' && (
                  <div className="px-2 py-1.5">
                    <input
                      type="text"
                      value={choice.model ?? ''}
                      onChange={(e) => setChoice({ cliTool, model: e.target.value.trim() })}
                      placeholder="provider/model"
                      aria-label={`${HARNESS_NAMES[cliTool]} model`}
                      className="w-full h-8 px-2 rounded-md bg-surface border border-border text-xs font-mono text-text-primary placeholder:text-text-disabled focus:outline-hidden focus:border-primary"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
