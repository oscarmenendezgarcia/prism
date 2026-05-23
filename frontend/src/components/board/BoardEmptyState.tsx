/**
 * BoardEmptyState — three-step onboarding guide shown when the active space
 * has zero tasks across all columns.
 *
 * Visibility is purely data-derived: no localStorage, no first-run flag.
 * Re-appears whenever the board is emptied again.
 *
 * ADR-1: replaces the three per-column EmptyState placeholders when isBoardEmpty.
 */

import React from 'react';
import { Button } from '@/components/shared/Button';

export interface BoardEmptyStateProps {
  onCreateTask: () => void;
}

interface StepProps {
  n: number;
  icon: string;
  title: string;
  body: string;
}

function Step({ n, icon, title, body }: StepProps) {
  return (
    <li className="flex gap-4 items-start p-4 rounded-lg bg-surface-elevated border border-border">
      <div
        className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center"
        aria-hidden="true"
      >
        {n}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="material-symbols-outlined text-base text-text-secondary" aria-hidden="true">
            {icon}
          </span>
          <h3 className="text-sm font-medium text-text-primary">{title}</h3>
        </div>
        <p className="text-xs text-text-secondary leading-relaxed">{body}</p>
      </div>
    </li>
  );
}

const STEPS: StepProps[] = [
  {
    n: 1,
    icon: 'dashboard',
    title: 'Create a space',
    body: 'Spaces group related tasks. Pick one from the sidebar, or create a new one with the + button.',
  },
  {
    n: 2,
    icon: 'add_task',
    title: 'Add a task',
    body: 'Describe what you want the agent pipeline to build, fix, or research.',
  },
  {
    n: 3,
    icon: 'play_arrow',
    title: 'Run the pipeline',
    body: 'Open the task and hit Run Pipeline to let the architect → UX → developer → reviewer → QA agents work.',
  },
];

export function BoardEmptyState({ onCreateTask }: BoardEmptyStateProps) {
  return (
    <section
      aria-labelledby="onboarding-title"
      className="flex flex-col items-center justify-center flex-1 px-6 py-12 max-w-2xl mx-auto text-center"
    >
      <span className="material-symbols-outlined text-6xl text-primary mb-4" aria-hidden="true">
        rocket_launch
      </span>

      <h2 id="onboarding-title" className="text-2xl font-semibold text-text-primary mb-2">
        Welcome to Prism
      </h2>

      <p className="text-sm text-text-secondary mb-8 max-w-md">
        Get started in three steps. Each step is a building block of the agent pipeline.
      </p>

      <ol className="w-full space-y-4 mb-8 text-left">
        {STEPS.map((step) => (
          <Step key={step.n} {...step} />
        ))}
      </ol>

      <Button
        variant="primary"
        onClick={onCreateTask}
        aria-label="Add your first task to start using Prism"
      >
        <span className="material-symbols-outlined text-lg" aria-hidden="true">add</span>
        Add your first task
      </Button>
    </section>
  );
}
