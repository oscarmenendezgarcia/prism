import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from '../../src/components/board/EmptyState';

describe('EmptyState', () => {
  it('renders the empty state message for todo column', () => {
    render(<EmptyState column="todo" />);
    expect(screen.getByText('No tasks yet')).toBeInTheDocument();
  });

  it('renders in-progress empty state', () => {
    render(<EmptyState column="in-progress" />);
    expect(screen.getByText('Nothing in progress')).toBeInTheDocument();
  });

  it('renders done empty state', () => {
    render(<EmptyState column="done" />);
    expect(screen.getByText('No completed tasks')).toBeInTheDocument();
  });
});
