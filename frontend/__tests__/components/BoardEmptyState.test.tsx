/**
 * Unit tests for the BoardEmptyState component.
 * Covers rendering, accessibility, and CTA behaviour.
 * ADR-1: onboarding guide is shown when the active space has zero tasks.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardEmptyState } from '../../src/components/board/BoardEmptyState';

describe('BoardEmptyState — rendering', () => {
  it('renders the section with aria-labelledby pointing to the title id', () => {
    render(<BoardEmptyState onCreateTask={vi.fn()} />);
    const section = screen.getByRole('region', { name: 'Your board is empty' });
    expect(section).toBeInTheDocument();
  });

  it('renders title "Your board is empty"', () => {
    render(<BoardEmptyState onCreateTask={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Your board is empty' })).toBeInTheDocument();
  });

  it('renders the subtitle paragraph', () => {
    render(<BoardEmptyState onCreateTask={vi.fn()} />);
    expect(screen.getByText(/Three steps to launch/i)).toBeInTheDocument();
  });

  it('renders an ordered list with exactly 3 step items', () => {
    render(<BoardEmptyState onCreateTask={vi.fn()} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
  });

  it('renders step titles: Create a space, Add a task, Run the pipeline', () => {
    render(<BoardEmptyState onCreateTask={vi.fn()} />);
    expect(screen.getByText('Create a space')).toBeInTheDocument();
    expect(screen.getByText('Add a task')).toBeInTheDocument();
    expect(screen.getByText('Run the pipeline')).toBeInTheDocument();
  });

  it('renders step number circles 1, 2, 3', () => {
    render(<BoardEmptyState onCreateTask={vi.fn()} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});

describe('BoardEmptyState — CTA button', () => {
  it('renders a primary CTA button', () => {
    render(<BoardEmptyState onCreateTask={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: /Add your first task to start using Prism/i }),
    ).toBeInTheDocument();
  });

  it('CTA button label contains "Add first task"', () => {
    render(<BoardEmptyState onCreateTask={vi.fn()} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent(/Add first task/i);
  });

  it('calls onCreateTask once when CTA is clicked', async () => {
    const onCreateTask = vi.fn();
    render(<BoardEmptyState onCreateTask={onCreateTask} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onCreateTask).toHaveBeenCalledOnce();
  });

  it('calls onCreateTask when CTA is activated via Enter key', async () => {
    const onCreateTask = vi.fn();
    render(<BoardEmptyState onCreateTask={onCreateTask} />);
    const btn = screen.getByRole('button');
    btn.focus();
    await userEvent.keyboard('{Enter}');
    expect(onCreateTask).toHaveBeenCalledOnce();
  });

  it('calls onCreateTask when CTA is activated via Space key', async () => {
    const onCreateTask = vi.fn();
    render(<BoardEmptyState onCreateTask={onCreateTask} />);
    const btn = screen.getByRole('button');
    btn.focus();
    await userEvent.keyboard(' ');
    expect(onCreateTask).toHaveBeenCalledOnce();
  });
});

describe('BoardEmptyState — accessibility', () => {
  it('title has id="onboarding-title" for aria-labelledby', () => {
    const { container } = render(<BoardEmptyState onCreateTask={vi.fn()} />);
    const h2 = container.querySelector('#onboarding-title');
    expect(h2).not.toBeNull();
    expect(h2?.textContent).toBe('Your board is empty');
  });

  it('step body text is present for each step', () => {
    render(<BoardEmptyState onCreateTask={vi.fn()} />);
    expect(screen.getByText(/Spaces group related tasks/i)).toBeInTheDocument();
    expect(screen.getByText(/Describe what you want the agent pipeline/i)).toBeInTheDocument();
    expect(screen.getByText(/Open the task and hit Run Pipeline/i)).toBeInTheDocument();
  });
});
