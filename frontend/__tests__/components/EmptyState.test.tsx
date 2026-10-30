import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from '../../src/components/board/EmptyState';

describe('EmptyState', () => {
  it('renders the empty state message for a to-do status', () => {
    render(<EmptyState column="todo" />);
    expect(screen.getByText('No issues here')).toBeInTheDocument();
  });

  it('renders the empty state of an in-progress status', () => {
    render(<EmptyState column="in-progress" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('renders the empty state of a done status', () => {
    render(<EmptyState column="done" />);
    expect(screen.getByText('Nothing done yet')).toBeInTheDocument();
  });
});
