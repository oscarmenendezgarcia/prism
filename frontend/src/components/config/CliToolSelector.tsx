/**
 * CliToolSelector — segmented control to pick the CLI tool that runs a stage.
 *
 * MODEL-2 wired `opencode` end-to-end in the backend (binary resolution +
 * provider/model routing for local/self-hosted models, e.g. a GB10/DGX box).
 * MODEL-3 added `pi` and `hermes`; all three are `provider/model` harnesses.
 *
 * `custom` is intentionally not offered here: it is a pipeline-stage-only
 * shell-command template (no single binary, no direct-spawn buildArgs) and is
 * not supported by Generate Tasks / the Launcher, which reject it with a 502.
 */

import React from 'react';
import type { HarnessInfo, ModelCliTool } from '@/types';
import { SegmentedControl } from './SegmentedControl';

const HARNESSES: ReadonlyArray<{ value: ModelCliTool; label: string }> = [
  { value: 'claude',   label: 'claude' },
  { value: 'opencode', label: 'opencode' },
  { value: 'pi',       label: 'pi' },
  { value: 'hermes',   label: 'hermes' },
];

interface CliToolSelectorProps {
  value: ModelCliTool;
  onChange: (value: ModelCliTool) => void;
  /** Used in aria-labels so screen readers know which agent this controls. */
  agentLabel: string;
  /**
   * Optional harness discovery info (GET /api/v1/harnesses). Unavailable
   * harnesses render disabled with an install link opened on click.
   */
  harnesses?: Record<string, HarnessInfo>;
}

export function CliToolSelector({ value, onChange, agentLabel, harnesses }: CliToolSelectorProps) {
  const options = HARNESSES.map(({ value: v, label }) => {
    const info = harnesses?.[v];
    const unavailable = !!harnesses && !!info && !info.available;
    return {
      value: v,
      label,
      disabled: unavailable,
      disabledTitle: unavailable ? `${label} not installed — click to install` : undefined,
      disabledHref:  unavailable ? info?.installUrl : undefined,
    };
  });
  return (
    <SegmentedControl<ModelCliTool>
      ariaLabel={`CLI tool for ${agentLabel}`}
      value={value}
      onChange={onChange}
      options={options}
    />
  );
}
