import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Board } from '../../src/components/board/Board';
import { useAppStore } from '../../src/stores/useAppStore';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(), getTasks: vi.fn(), createTask: vi.fn(), moveTask: vi.fn(),
  deleteTask: vi.fn(), createSpace: vi.fn(), renameSpace: vi.fn(), deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
}));

beforeEach(() => {
  useAppStore.setState({ tasks: { todo: [], 'in-progress': [], done: [] } });
});

describe('Board', () => {
  it('renders all 3 columns', () => {
    render(<Board />);
    // MB-1: column labels appear in both the tab bar and the column header
    expect(screen.getAllByText('Todo').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('In Progress').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Done').length).toBeGreaterThanOrEqual(1);
  });

  it('renders tasks from the store', () => {
    useAppStore.setState({
      tasks: {
        todo: [{ id: 't1', title: 'My Task', type: 'task', createdAt: '', updatedAt: '' }],
        'in-progress': [],
        done: [],
      },
    });
    render(<Board />);
    expect(screen.getByText('My Task')).toBeInTheDocument();
  });
});
