/**
 * CliToolSelector — segmented control to pick the CLI tool that runs a stage.
 *
 * MODEL-2 wired `opencode` end-to-end in the backend (binary resolution +
 * provider/model routing for local/self-hosted models, e.g. a GB10/DGX box).
 * This control exposes that choice per agent in the Proposal D expanded card.
 *
 * `custom` is a reserved backend value (spawning not implemented) and is not
 * offered here.
 */

import React from 'react';
import type { ModelCliTool } from '@/types';
import { SegmentedControl } from './SegmentedControl';

const OPTIONS: ReadonlyArray<{ value: ModelCliTool; label: string }> = [
  { value: 'claude',   label: 'Claude' },
  { value: 'opencode', label: 'opencode' },
];

interface CliToolSelectorProps {
  value: ModelCliTool;
  onChange: (value: ModelCliTool) => void;
  /** Used in aria-labels so screen readers know which agent this controls. */
  agentLabel: string;
}

export function CliToolSelector({ value, onChange, agentLabel }: CliToolSelectorProps) {
  return (
    <SegmentedControl<ModelCliTool>
      ariaLabel={`CLI tool for ${agentLabel}`}
      value={value}
      onChange={onChange}
      options={OPTIONS}
    />
  );
}
