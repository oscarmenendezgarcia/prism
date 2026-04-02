import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AutoTaskFAB } from '../../src/components/AutoTaskFAB';

describe('AutoTaskFAB', () => {
  it('renders a button with correct aria-label', () => {
    render(<AutoTaskFAB onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /auto-task: open ai task generator/i })).toBeInTheDocument();
  });

  it('renders the auto_awesome icon', () => {
    render(<AutoTaskFAB onClick={vi.fn()} />);
    expect(screen.getByText('auto_awesome')).toBeInTheDocument();
  });

  it('renders the label text', () => {
    render(<AutoTaskFAB onClick={vi.fn()} />);
    expect(screen.getByText('Auto-task')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<AutoTaskFAB onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('has data-autotask-fab attribute for focus restoration', () => {
    render(<AutoTaskFAB onClick={vi.fn()} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('data-autotask-fab');
  });

  it('applies the autotask-fab CSS class', () => {
    render(<AutoTaskFAB onClick={vi.fn()} />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('autotask-fab');
  });
});
