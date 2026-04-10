import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Toast } from '../../src/components/shared/Toast';
import { useAppStore } from '../../src/stores/useAppStore';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(),
  getTasks: vi.fn(),
  createTask: vi.fn(),
  moveTask: vi.fn(),
  deleteTask: vi.fn(),
  createSpace: vi.fn(),
  renameSpace: vi.fn(),
  deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
}));

beforeEach(() => {
  useAppStore.setState({ toast: null });
});

describe('Toast', () => {
  it('renders nothing when toast is null', () => {
    const { container } = render(<Toast />);
    expect(container.firstChild).toBeNull();
  });

  it('renders success toast with correct message', () => {
    useAppStore.setState({ toast: { message: 'Task created', type: 'success' } });
    render(<Toast />);
    expect(screen.getByText('Task created')).toBeInTheDocument();
  });

  it('renders error toast with red background class', () => {
    useAppStore.setState({ toast: { message: 'Something failed', type: 'error' } });
    render(<Toast />);
    // BUG-006: error toasts use role="alert"
    const toast = document.body.querySelector('[role="alert"]');
    expect(toast).toHaveClass('bg-error');
  });

  it('renders success toast with green background class', () => {
    useAppStore.setState({ toast: { message: 'Done', type: 'success' } });
    render(<Toast />);
    const toast = document.body.querySelector('[role="status"]');
    expect(toast).toHaveClass('bg-success');
  });

  it('success toast has role="status" and aria-live="polite"', () => {
    useAppStore.setState({ toast: { message: 'Hello', type: 'success' } });
    render(<Toast />);
    const toast = document.body.querySelector('[role="status"]');
    expect(toast).toHaveAttribute('aria-live', 'polite');
  });

  it('error toast has role="alert" and aria-live="assertive"', () => {
    useAppStore.setState({ toast: { message: 'Error!', type: 'error' } });
    render(<Toast />);
    const toast = document.body.querySelector('[role="alert"]');
    expect(toast).toHaveAttribute('aria-live', 'assertive');
  });
});
