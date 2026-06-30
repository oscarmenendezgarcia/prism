/**
 * SkillsReadOnly — displays an agent's skills as read-only chips.
 *
 * Phase 1: no add/remove affordance. The "+ Add skill" dashed pill from the
 * mockup is omitted (requires backend catalog in Phase 2).
 *
 * Empty state: "No skills configured" with a subtle icon.
 */

import React from 'react';

interface SkillsReadOnlyProps {
  skills: string[];
  loading?: boolean;
}

export function SkillsReadOnly({ skills, loading = false }: SkillsReadOnlyProps) {
  if (loading) {
    return (
      <div className="flex gap-2">
        {[0, 1].map((i) => (
          <span
            key={i}
            className="h-6 w-24 rounded-lg bg-surface-variant animate-pulse"
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <p className="text-[11.5px] text-text-secondary italic">
        No skills configured
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.map((skill) => (
        <span
          key={skill}
          className={[
            'inline-flex items-center gap-1.5',
            'px-2.5 py-1 rounded-lg',
            'text-[11.5px] font-medium font-mono',
            'bg-primary-container text-primary',
            'border border-primary/30',
          ].join(' ')}
        >
          {skill}
        </span>
      ))}
    </div>
  );
}
