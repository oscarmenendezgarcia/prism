import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AutoTaskModal } from '../../src/components/AutoTaskModal';
import { useAppStore } from '../../src/stores/useAppStore';
import * as client from '../../src/api/client';

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
  generateAutoTasks: vi.fn(),
}));

const mockSpace = { id: 'space-1', name: 'My Space', createdAt: '', updatedAt: '' };

beforeEach(() => {
  useAppStore.setState({
    spaces: [mockSpace],
    activeSpaceId: 'space-1',
    tasks: { todo: [], 'in-progress': [], done: [] },
  });
  vi.clearAllMocks();
});

describe('AutoTaskModal', () => {
  it('does not render when closed', () => {
    render(<AutoTaskModal open={false} onClose={vi.fn()} />);
    expect(document.body.querySelector('[aria-labelledby="autotask-modal-title"]')).toBeNull();
  });

  it('renders title and subtitle when open', () => {
    render(<AutoTaskModal open={true} onClose={vi.fn()} />);
    expect(document.body.querySelector('#autotask-modal-title')).toBeInTheDocument();
    expect(document.body.textContent).toContain('Auto-task');
    expect(document.body.textContent).toContain('Describe what you need');
  });

  it('renders Generate tasks button', () => {
    render(<AutoTaskModal open={true} onClose={vi.fn()} />);
    expect(document.body.querySelector('button[type="submit"]') ||
           Array.from(document.body.querySelectorAll('button')).find(b => b.textContent?.includes('Generate tasks'))
    ).toBeTruthy();
  });

  it('renders space and column selectors', () => {
    render(<AutoTaskModal open={true} onClose={vi.fn()} />);
    const selects = document.body.querySelectorAll('select');
    expect(selects.length).toBeGreaterThanOrEqual(2);
    // space selector has the space name
    expect(document.body.textContent).toContain('My Space');
    // column selector has Todo
    expect(document.body.textContent).toContain('Todo');
  });

  it('shows error when submitting with empty prompt', async () => {
    render(<AutoTaskModal open={true} onClose={vi.fn()} />);
    const form = document.body.querySelector('form#autotask-form')!;
    fireEvent.submit(form);
    await waitFor(() => {
      expect(document.body.querySelector('[role="alert"]')).toBeInTheDocument();
    });
  });

  it('calls generateAutoTasks and closes modal on success', async () => {
    const generateAutoTasks = vi.mocked(client.generateAutoTasks);
    generateAutoTasks.mockResolvedValue({ tasksCreated: 3, tasks: [] });

    vi.spyOn(useAppStore.getState(), 'loadBoard').mockResolvedValue(undefined);

    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<AutoTaskModal open={true} onClose={onClose} />);

    const textarea = document.body.querySelector('textarea')!;
    await user.type(textarea, 'Build authentication');

    const form = document.body.querySelector('form#autotask-form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(generateAutoTasks).toHaveBeenCalledWith('space-1', 'Build authentication', 'todo');
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows error message when API call fails', async () => {
    const generateAutoTasks = vi.mocked(client.generateAutoTasks);
    generateAutoTasks.mockRejectedValue(new Error('AI CLI error'));

    const user = userEvent.setup();
    render(<AutoTaskModal open={true} onClose={vi.fn()} />);

    const textarea = document.body.querySelector('textarea')!;
    await user.type(textarea, 'Build something');

    const form = document.body.querySelector('form#autotask-form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(document.body.querySelector('[role="alert"]')).toBeInTheDocument();
      expect(document.body.textContent).toContain('AI CLI error');
    });
  });

  it('shows "Try again" button text after error', async () => {
    const generateAutoTasks = vi.mocked(client.generateAutoTasks);
    generateAutoTasks.mockRejectedValue(new Error('network error'));

    const user = userEvent.setup();
    render(<AutoTaskModal open={true} onClose={vi.fn()} />);

    const textarea = document.body.querySelector('textarea')!;
    await user.type(textarea, 'Build something');

    const form = document.body.querySelector('form#autotask-form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      const buttons = Array.from(document.body.querySelectorAll('button'));
      const tryAgainBtn = buttons.find(b => b.textContent?.includes('Try again'));
      expect(tryAgainBtn).toBeTruthy();
    });
  });

  it('disables textarea while loading', async () => {
    let resolvePromise!: (v: { tasksCreated: number; tasks: [] }) => void;
    const generateAutoTasks = vi.mocked(client.generateAutoTasks);
    generateAutoTasks.mockImplementation(
      () => new Promise((resolve) => { resolvePromise = resolve; })
    );

    const user = userEvent.setup();
    render(<AutoTaskModal open={true} onClose={vi.fn()} />);

    const textarea = document.body.querySelector('textarea')!;
    await user.type(textarea, 'Do something');

    const form = document.body.querySelector('form#autotask-form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(document.body.querySelector('textarea')).toBeDisabled();
    });

    resolvePromise({ tasksCreated: 0, tasks: [] });
  });

  it('resets prompt on re-open', async () => {
    const { rerender } = render(<AutoTaskModal open={true} onClose={vi.fn()} />);

    const textarea = document.body.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'old text' } });
    expect(textarea.value).toBe('old text');

    rerender(<AutoTaskModal open={false} onClose={vi.fn()} />);
    rerender(<AutoTaskModal open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      const freshTextarea = document.body.querySelector('textarea');
      expect(freshTextarea?.value).toBe('');
    });
  });

  it('renders AI-powered attribution', () => {
    render(<AutoTaskModal open={true} onClose={vi.fn()} />);
    expect(document.body.textContent).toContain('AI-powered by Claude');
  });
});
