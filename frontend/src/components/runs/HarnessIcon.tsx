/**
 * Logo of the CLI harness that runs a task.
 */

import React from 'react';
import type { ModelCliTool } from '@/types';
import claudeLogo from '@/assets/harness/claude.svg';
import opencodeLogo from '@/assets/harness/opencode.svg';
import piLogo from '@/assets/harness/pi.svg';
import hermesLogo from '@/assets/harness/hermes.png';

export type DirectCliTool = Exclude<ModelCliTool, 'custom'>;

export const HARNESS_NAMES: Record<DirectCliTool, string> = {
  claude:   'Claude Code',
  opencode: 'opencode',
  pi:       'pi',
  hermes:   'Hermes',
};

const LOGOS: Record<DirectCliTool, string> = {
  claude:   claudeLogo,
  opencode: opencodeLogo,
  pi:       piLogo,
  hermes:   hermesLogo,
};

interface HarnessIconProps {
  cliTool: string;
  className?: string;
}

export function HarnessIcon({ cliTool, className = 'w-4 h-4' }: HarnessIconProps) {
  const logo = LOGOS[cliTool as DirectCliTool];
  if (!logo) {
    return (
      <span className={`material-symbols-outlined text-sm leading-none ${className}`} aria-hidden="true">terminal</span>
    );
  }
  return (
    <img
      src={logo}
      alt=""
      title={HARNESS_NAMES[cliTool as DirectCliTool]}
      // pi's logo is black on transparent, invisible on the dark theme.
      className={`rounded-sm flex-shrink-0 ${cliTool === 'pi' ? 'dark:invert' : ''} ${className}`}
    />
  );
}
