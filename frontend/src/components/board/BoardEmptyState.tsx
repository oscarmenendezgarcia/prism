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
  className?: string;
}

function Step({ n, icon, title, body, className = '' }: StepProps) {
  return (
    <li className={`flex gap-3 animate-fade-in-up ${className}`}>
      <div
        className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold flex items-center justify-center"
        aria-hidden="true"
      >
        {n}
      </div>
      <div className="flex-1 min-w-0 pb-4 border-b border-border last:border-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="material-symbols-outlined text-[15px] text-text-tertiary" aria-hidden="true">
            {icon}
          </span>
          <span className="text-sm font-medium text-text-primary">{title}</span>
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
    body: 'Open the task and hit Run Pipeline — architect → UX → developer → reviewer → QA.',
  },
];

export function BoardEmptyState({ onCreateTask }: BoardEmptyStateProps) {
  return (
    <section
      aria-labelledby="onboarding-title"
      className="flex flex-1 items-center justify-center px-8 py-12"
    >
      {/* Split layout: left 40% / right 60% on md+, stacked on mobile */}
      <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-10 md:gap-16 items-start">

        {/* Left — headline + CTA */}
        <div className="flex flex-col gap-6 md:pt-1">
          <div className="animate-fade-in-up [animation-delay:0ms]">
            <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-widest mb-3">
              Getting started
            </p>
            <h2
              id="onboarding-title"
              className="text-2xl sm:text-3xl font-semibold text-text-primary tracking-tight leading-tight"
            >
              Your board is empty
            </h2>
            <p className="mt-2 text-sm text-text-secondary leading-relaxed">
              Three steps to launch your first agent pipeline.
            </p>
          </div>

          <div className="animate-fade-in-up [animation-delay:60ms]">
            <Button
              variant="primary"
              onClick={onCreateTask}
              aria-label="Add your first task to start using Prism"
              className="min-h-[44px] active:scale-[0.97] transition-transform duration-100"
            >
              <span className="material-symbols-outlined text-lg" aria-hidden="true">add</span>
              Add first task
            </Button>
          </div>
        </div>

        {/* Right — steps */}
        <ol className="flex flex-col gap-0">
          <Step {...STEPS[0]} className="[animation-delay:120ms]" />
          <Step {...STEPS[1]} className="[animation-delay:190ms]" />
          <Step {...STEPS[2]} className="[animation-delay:260ms]" />
        </ol>

      </div>
    </section>
  );
}
