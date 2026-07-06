/**
 * ScopeSelector — segmented Global | Space control.
 *
 * Space option is disabled when no active space is provided.
 */

import React from 'react';
import { SegmentedControl } from './SegmentedControl';

export type Scope = 'global' | 'space';

interface ScopeSelectorProps {
  scope:         Scope;
  spaceName?:    string; // active space name; undefined → Space option is disabled
  onChange:      (scope: Scope) => void;
}

export function ScopeSelector({ scope, spaceName, onChange }: ScopeSelectorProps) {
  const spaceDisabled = !spaceName;

  return (
    <SegmentedControl<Scope>
      ariaLabel="Model routing scope"
      value={scope}
      onChange={onChange}
      options={[
        { value: 'global', label: 'Global' },
        {
          value: 'space',
          label: spaceName ? `Space · ${spaceName}` : 'Space',
          disabled: spaceDisabled,
          disabledTitle: 'Open a space to edit space-level routing',
        },
      ]}
    />
  );
}
