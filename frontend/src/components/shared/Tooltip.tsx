/**
 * Tooltip — lightweight hover tooltip wrapper.
 * Uses CSS group-hover so it requires no JS state.
 * Position: below the trigger by default (suits header icon buttons).
 *
 * Usage:
 *   <Tooltip label="Terminal" description="Ejecuta comandos en el servidor">
 *     <TerminalToggle />
 *   </Tooltip>
 */

import React from 'react';

interface TooltipProps {
  /** Bold first line — panel or action name. */
  label: string;
  /** Optional second line — short contextual description. */
  description?: string;
  children: React.ReactNode;
  /** Where the tooltip appears relative to the trigger. Default: 'bottom'. */
  position?: 'bottom' | 'top';
}

export function Tooltip({ label, description, children, position = 'bottom' }: TooltipProps) {
  const positionClasses =
    position === 'bottom'
      ? 'top-full mt-2 left-1/2 -translate-x-1/2'
      : 'bottom-full mb-2 left-1/2 -translate-x-1/2';

  return (
    <div className="relative group/tt">
      {children}

      {/* Tooltip bubble */}
      <div
        role="tooltip"
        className={[
          'absolute z-[300] pointer-events-none',
          positionClasses,
          'w-max max-w-[220px]',
          'px-3 py-2',
          'bg-surface-elevated border border-border rounded-md shadow-md',
          // Enter / exit animation
          'opacity-0 translate-y-1',
          'group-hover/tt:opacity-100 group-hover/tt:translate-y-0',
          'transition-all duration-fast ease-default',
          '[transition-delay:400ms]',
          'group-hover/tt:[transition-delay:400ms]',
        ].join(' ')}
      >
        <p className="text-xs font-semibold text-text-primary whitespace-nowrap leading-tight">
          {label}
        </p>
        {description && (
          <p className="text-xs text-text-secondary mt-0.5 whitespace-nowrap leading-snug">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
