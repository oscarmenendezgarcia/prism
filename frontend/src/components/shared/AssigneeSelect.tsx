/**
 * Who an issue is assigned to: a person or an agent. A native list, because it works the same
 * with a mouse, a keyboard and a phone, and finds names as you type.
 */

import { useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { AGENT_IDS, AGENT_NAMES, agentIsOn, agentOf } from '@/utils/agents';

interface AssigneeSelectProps {
  id: string;
  value: string;
  onChange: (assigned: string) => void;
  className?: string;
  'aria-label'?: string;
  /** Nobody chosen yet, with this in their place, which is not the same as unassigned. */
  placeholder?: string;
}

const NOT_CHOSEN = '\u0000';

export function AssigneeSelect({ id, value, onChange, className, 'aria-label': ariaLabel, placeholder }: AssigneeSelectProps) {
  const people = useAuthStore((s) => s.people);
  const loadPeople = useAuthStore((s) => s.loadPeople);
  const space = useAppStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId));

  useEffect(() => { void loadPeople(); }, [loadPeople]);

  const active = people.filter((p) => p.active);
  // Someone who left, or a name from before accounts: it stays until someone changes it.
  const elsewhere = !!value && !agentOf(value) && !active.some((p) => p.name === value);

  return (
    <select id={id} value={placeholder ? NOT_CHOSEN : value} onChange={(e) => onChange(e.target.value)} className={className} aria-label={ariaLabel}>
      {placeholder && <option value={NOT_CHOSEN} disabled>{placeholder}</option>}
      <option value="">Unassigned</option>
      {elsewhere && <option value={value}>{value} (no account)</option>}
      <optgroup label="People">
        {active.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
      </optgroup>
      <optgroup label="Agents">
        {AGENT_IDS.map((agent) => {
          const on = agentIsOn(space, agent);
          return <option key={agent} value={agent} disabled={!on && value !== agent}>{AGENT_NAMES[agent]}{on ? '' : ' (off here)'}</option>;
        })}
      </optgroup>
    </select>
  );
}
