import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommentsSection } from '@/components/board/CommentsSection';

const base = {
  spaceId: 's', taskId: 't', comments: [],
  onCommentCreated: vi.fn().mockResolvedValue(undefined),
  onCommentUpdated: vi.fn().mockResolvedValue(undefined),
  onAnswerQuestion: vi.fn().mockResolvedValue(undefined),
};

describe('CommentsSection request changes', () => {
  it('has no extra buttons without a finished run', () => {
    render(<CommentsSection {...base} />);
    expect(screen.queryByRole('button', { name: 'Request changes' })).toBeNull();
  });

  it('sends the text to the agent and clears the draft', async () => {
    const onRequestChanges = vi.fn().mockResolvedValue(undefined);
    render(<CommentsSection {...base} onRequestChanges={onRequestChanges} />);
    const box = screen.getByLabelText('Write a comment');
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeDisabled();
    await userEvent.type(box, 'Rename it');
    await userEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    expect(onRequestChanges).toHaveBeenCalledWith('Rename it');
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('keeps the draft when the request fails', async () => {
    const onRequestChanges = vi.fn().mockRejectedValue(new Error('nope'));
    render(<CommentsSection {...base} onRequestChanges={onRequestChanges} />);
    const box = screen.getByLabelText('Write a comment');
    await userEvent.type(box, 'Rename it');
    await userEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    await waitFor(() => expect(onRequestChanges).toHaveBeenCalled());
    expect(box).toHaveValue('Rename it');
  });

  it('just comments without relaunching', async () => {
    const onRequestChanges = vi.fn();
    render(<CommentsSection {...base} onRequestChanges={onRequestChanges} />);
    await userEvent.type(screen.getByLabelText('Write a comment'), 'A note');
    await userEvent.click(screen.getByRole('button', { name: 'Just comment' }));
    expect(base.onCommentCreated).toHaveBeenCalled();
    expect(onRequestChanges).not.toHaveBeenCalled();
  });
});
