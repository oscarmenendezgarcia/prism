import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpaceHookSection } from '../SpaceHookSection';
import { useAppStore } from '@/stores/useAppStore';
import * as api from '@/api/client';
import type { Space } from '@/types';

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  updateSpaceHooks: vi.fn().mockResolvedValue({}),
}));

const space: Space = { id: 's1', name: 'S', createdAt: '', updatedAt: '' };
const update = () => screen.getByRole('button', { name: /update check/i });

describe('SpaceHookSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ loadSpaces: vi.fn().mockResolvedValue(undefined), showToast: vi.fn() } as never);
  });

  it('saves a new command', async () => {
    render(<SpaceHookSection space={space} />);
    expect(update()).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Command'), 'npm test');
    await userEvent.click(update());
    expect(api.updateSpaceHooks).toHaveBeenCalledWith('s1', [{ name: 'Tests', command: 'npm test' }]);
  });

  it('removes the check when the command is emptied', async () => {
    render(<SpaceHookSection space={{ ...space, hooks: [{ name: 'Tests', command: 'x' }] }} />);
    await userEvent.clear(screen.getByLabelText('Command'));
    await userEvent.click(update());
    expect(api.updateSpaceHooks).toHaveBeenCalledWith('s1', []);
  });

  it('shows why the server refused', async () => {
    vi.mocked(api.updateSpaceHooks).mockRejectedValueOnce(new Error('Wait for the running tasks to finish'));
    render(<SpaceHookSection space={space} />);
    await userEvent.type(screen.getByLabelText('Command'), 'x');
    await userEvent.click(update());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Wait for the running tasks'));
  });
});
