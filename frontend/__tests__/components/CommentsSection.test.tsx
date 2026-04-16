/**
 * Unit tests for CommentsSection component.
 * Covers: empty state, note/question/answer rendering, threading, resolve toggle,
 *         add-comment form (type selector, submit, ⌘↵ shortcut), disabled state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CommentsSection } from '../../src/components/board/CommentsSection';
import type { Comment } from '../../src/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOTE: Comment = {
  id: 'c-note-1',
  author: 'senior-architect',
  text: 'This is a note about the design.',
  type: 'note',
  resolved: false,
  createdAt: '2026-04-16T10:00:00.000Z',
};

const QUESTION: Comment = {
  id: 'c-q-1',
  author: 'developer-agent',
  text: 'What is the SLA requirement?',
  type: 'question',
  resolved: false,
  createdAt: '2026-04-16T11:00:00.000Z',
};

const RESOLVED_QUESTION: Comment = {
  ...QUESTION,
  id: 'c-q-resolved',
  resolved: true,
};

const ANSWER: Comment = {
  id: 'c-a-1',
  author: 'user',
  text: 'p99 < 200 ms',
  type: 'answer',
  parentId: 'c-q-1',
  resolved: false,
  createdAt: '2026-04-16T11:30:00.000Z',
};

const QUESTION_WITH_TARGET: Comment = {
  ...QUESTION,
  id: 'c-q-target',
  targetAgent: 'senior-architect',
};

const QUESTION_NEEDS_HUMAN: Comment = {
  ...QUESTION,
  id: 'c-q-human',
  needsHuman: true,
};

// ---------------------------------------------------------------------------
// Default props factory
// ---------------------------------------------------------------------------

function makeProps(comments: Comment[] = [], overrides = {}) {
  return {
    spaceId: 'space-1',
    taskId: 'task-1',
    comments,
    onCommentCreated: vi.fn().mockResolvedValue(undefined),
    onCommentUpdated: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('CommentsSection — empty state', () => {
  it('renders the Comments section heading', () => {
    render(<CommentsSection {...makeProps()} />);
    expect(screen.getByText('Comments')).toBeInTheDocument();
  });

  it('shows "No comments yet" when comments array is empty', () => {
    render(<CommentsSection {...makeProps()} />);
    expect(screen.getByTestId('comments-empty')).toBeInTheDocument();
    expect(screen.getByText('No comments yet')).toBeInTheDocument();
  });

  it('does not render unresolved badge when no questions exist', () => {
    render(<CommentsSection {...makeProps()} />);
    expect(screen.queryByTestId('unresolved-badge')).toBeNull();
  });

  it('renders the add-comment form', () => {
    render(<CommentsSection {...makeProps()} />);
    expect(screen.getByTestId('add-comment-form')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Comment rendering
// ---------------------------------------------------------------------------

describe('CommentsSection — rendering comments', () => {
  it('renders a note bubble', () => {
    render(<CommentsSection {...makeProps([NOTE])} />);
    expect(screen.getByText('This is a note about the design.')).toBeInTheDocument();
    // The type-badge pill (not the form type-selector button)
    expect(screen.getByTestId('comment-type-badge')).toHaveTextContent('note');
  });

  it('renders an unresolved question with amber "question" badge', () => {
    render(<CommentsSection {...makeProps([QUESTION])} />);
    expect(screen.getByText('What is the SLA requirement?')).toBeInTheDocument();
    // The type-badge pill (not the form type-selector button)
    expect(screen.getByTestId('comment-type-badge')).toHaveTextContent('question');
  });

  it('renders a resolved question with "resolved" badge', () => {
    render(<CommentsSection {...makeProps([RESOLVED_QUESTION])} />);
    // Badge switches to "resolved" text — not "question"
    const badge = screen.getByTestId('comment-type-badge');
    expect(badge).toHaveTextContent('resolved');
    expect(badge).not.toHaveTextContent('question');
  });

  it('renders an answer indented under its parent question', () => {
    render(<CommentsSection {...makeProps([QUESTION, ANSWER])} />);
    expect(screen.getByText('p99 < 200 ms')).toBeInTheDocument();
  });

  it('shows comment count next to heading', () => {
    render(<CommentsSection {...makeProps([NOTE, QUESTION])} />);
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Unresolved question badge
// ---------------------------------------------------------------------------

describe('CommentsSection — unresolved badge', () => {
  it('shows unresolved badge count when there are pending questions', () => {
    render(<CommentsSection {...makeProps([QUESTION])} />);
    const badge = screen.getByTestId('unresolved-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('1 pending');
  });

  it('hides badge when all questions are resolved', () => {
    render(<CommentsSection {...makeProps([RESOLVED_QUESTION])} />);
    expect(screen.queryByTestId('unresolved-badge')).toBeNull();
  });

  it('counts only unresolved questions', () => {
    render(<CommentsSection {...makeProps([QUESTION, RESOLVED_QUESTION])} />);
    const badge = screen.getByTestId('unresolved-badge');
    expect(badge).toHaveTextContent('1 pending');
  });
});

// ---------------------------------------------------------------------------
// Resolve toggle
// ---------------------------------------------------------------------------

describe('CommentsSection — resolve toggle', () => {
  it('calls onCommentUpdated with resolved=true when resolve button clicked', async () => {
    const onCommentUpdated = vi.fn().mockResolvedValue(undefined);
    render(
      <CommentsSection {...makeProps([QUESTION], { onCommentUpdated })} />,
    );
    const resolveBtn = screen.getByRole('button', { name: /mark as resolved/i });
    fireEvent.click(resolveBtn);
    await waitFor(() => {
      expect(onCommentUpdated).toHaveBeenCalledWith(QUESTION.id, { resolved: true });
    });
  });

  it('calls onCommentUpdated with resolved=false when un-resolve button clicked', async () => {
    const onCommentUpdated = vi.fn().mockResolvedValue(undefined);
    render(
      <CommentsSection {...makeProps([RESOLVED_QUESTION], { onCommentUpdated })} />,
    );
    const unResolveBtn = screen.getByRole('button', { name: /mark as unresolved/i });
    fireEvent.click(unResolveBtn);
    await waitFor(() => {
      expect(onCommentUpdated).toHaveBeenCalledWith(RESOLVED_QUESTION.id, { resolved: false });
    });
  });

  it('does not render resolve button for notes', () => {
    render(<CommentsSection {...makeProps([NOTE])} />);
    expect(screen.queryByRole('button', { name: /mark as resolved/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Add-comment form
// ---------------------------------------------------------------------------

describe('CommentsSection — add-comment form', () => {
  it('defaults type to "note"', () => {
    render(<CommentsSection {...makeProps()} />);
    const noteBtn = screen.getByRole('radio', { name: /note/i });
    expect(noteBtn).toHaveAttribute('aria-checked', 'true');
  });

  it('switches type when a type button is clicked', () => {
    render(<CommentsSection {...makeProps()} />);
    const questionBtn = screen.getByRole('radio', { name: /question/i });
    fireEvent.click(questionBtn);
    expect(questionBtn).toHaveAttribute('aria-checked', 'true');
  });

  it('submits comment via Post button click', async () => {
    const onCommentCreated = vi.fn().mockResolvedValue(undefined);
    render(<CommentsSection {...makeProps([], { onCommentCreated })} />);

    const textarea = screen.getByRole('textbox', { name: /comment text/i });
    fireEvent.change(textarea, { target: { value: 'Hello world' } });

    const submitBtn = screen.getByRole('button', { name: /post comment/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onCommentCreated).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Hello world', type: 'note' }),
      );
    });
  });

  it('submits via ⌘↵ keyboard shortcut', async () => {
    const onCommentCreated = vi.fn().mockResolvedValue(undefined);
    render(<CommentsSection {...makeProps([], { onCommentCreated })} />);

    const textarea = screen.getByRole('textbox', { name: /comment text/i });
    fireEvent.change(textarea, { target: { value: 'Keyboard submit' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

    await waitFor(() => {
      expect(onCommentCreated).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Keyboard submit' }),
      );
    });
  });

  it('clears the textarea after successful submit', async () => {
    const onCommentCreated = vi.fn().mockResolvedValue(undefined);
    render(<CommentsSection {...makeProps([], { onCommentCreated })} />);

    const textarea = screen.getByRole('textbox', { name: /comment text/i });
    fireEvent.change(textarea, { target: { value: 'Will be cleared' } });
    fireEvent.click(screen.getByRole('button', { name: /post comment/i }));

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('');
    });
  });

  it('disables the submit button when text is empty', () => {
    render(<CommentsSection {...makeProps()} />);
    const submitBtn = screen.getByRole('button', { name: /post comment/i });
    expect(submitBtn).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// targetAgent in form (feature 1)
// ---------------------------------------------------------------------------

describe('CommentsSection — targetAgent input in form', () => {
  it('does not show route-to-agent input when type is "note"', () => {
    render(<CommentsSection {...makeProps()} />);
    expect(screen.queryByTestId('target-agent-input')).toBeNull();
  });

  it('shows route-to-agent input when type is "question"', () => {
    render(<CommentsSection {...makeProps()} />);
    fireEvent.click(screen.getByRole('radio', { name: /question/i }));
    expect(screen.getByTestId('target-agent-input')).toBeInTheDocument();
  });

  it('hides route-to-agent input again when switching back to "note"', () => {
    render(<CommentsSection {...makeProps()} />);
    fireEvent.click(screen.getByRole('radio', { name: /question/i }));
    fireEvent.click(screen.getByRole('radio', { name: /note/i }));
    expect(screen.queryByTestId('target-agent-input')).toBeNull();
  });

  it('passes targetAgent in the onCommentCreated payload when filled in', async () => {
    const onCommentCreated = vi.fn().mockResolvedValue(undefined);
    render(<CommentsSection {...makeProps([], { onCommentCreated })} />);

    fireEvent.click(screen.getByRole('radio', { name: /question/i }));
    fireEvent.change(screen.getByTestId('target-agent-input'), {
      target: { value: 'senior-architect' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /comment text/i }), {
      target: { value: 'Is the SLA defined?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /post comment/i }));

    await waitFor(() => {
      expect(onCommentCreated).toHaveBeenCalledWith(
        expect.objectContaining({ targetAgent: 'senior-architect', type: 'question' }),
      );
    });
  });

  it('omits targetAgent from payload when input is left blank', async () => {
    const onCommentCreated = vi.fn().mockResolvedValue(undefined);
    render(<CommentsSection {...makeProps([], { onCommentCreated })} />);

    fireEvent.click(screen.getByRole('radio', { name: /question/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /comment text/i }), {
      target: { value: 'What is the SLA?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /post comment/i }));

    await waitFor(() => {
      expect(onCommentCreated).toHaveBeenCalledWith(
        expect.not.objectContaining({ targetAgent: expect.anything() }),
      );
    });
  });

  it('clears the route-to-agent input after successful submit', async () => {
    const onCommentCreated = vi.fn().mockResolvedValue(undefined);
    render(<CommentsSection {...makeProps([], { onCommentCreated })} />);

    fireEvent.click(screen.getByRole('radio', { name: /question/i }));
    const agentInput = screen.getByTestId('target-agent-input');
    fireEvent.change(agentInput, { target: { value: 'qa-engineer-e2e' } });
    fireEvent.change(screen.getByRole('textbox', { name: /comment text/i }), {
      target: { value: 'Is coverage >90%?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /post comment/i }));

    await waitFor(() => {
      expect((agentInput as HTMLInputElement).value).toBe('');
    });
  });
});

// ---------------------------------------------------------------------------
// NEEDS_HUMAN badge (feature 2)
// ---------------------------------------------------------------------------

describe('CommentsSection — NEEDS_HUMAN badge', () => {
  it('does not show needs-human badge when needsHuman is false/undefined', () => {
    render(<CommentsSection {...makeProps([QUESTION])} />);
    expect(screen.queryByTestId('needs-human-badge')).toBeNull();
  });

  it('shows needs-human badge when needsHuman===true', () => {
    render(<CommentsSection {...makeProps([QUESTION_NEEDS_HUMAN])} />);
    const badge = screen.getByTestId('needs-human-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('needs human');
  });

  it('needs-human badge is visible alongside the question type badge', () => {
    render(<CommentsSection {...makeProps([QUESTION_NEEDS_HUMAN])} />);
    expect(screen.getByTestId('comment-type-badge')).toBeInTheDocument();
    expect(screen.getByTestId('needs-human-badge')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// targetAgent display in bubble (feature 3)
// ---------------------------------------------------------------------------

describe('CommentsSection — targetAgent display in bubble', () => {
  it('does not render target-agent indicator when targetAgent is absent', () => {
    render(<CommentsSection {...makeProps([QUESTION])} />);
    expect(screen.queryByTestId('comment-target-agent')).toBeNull();
  });

  it('renders "→ <targetAgent>" when targetAgent is set', () => {
    render(<CommentsSection {...makeProps([QUESTION_WITH_TARGET])} />);
    const indicator = screen.getByTestId('comment-target-agent');
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveTextContent('→ senior-architect');
  });

  it('target-agent indicator appears in the header row', () => {
    render(<CommentsSection {...makeProps([QUESTION_WITH_TARGET])} />);
    const bubble = screen.getByTestId('comment-bubble');
    expect(bubble.querySelector('[data-testid="comment-target-agent"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Disabled state
// ---------------------------------------------------------------------------

describe('CommentsSection — disabled state', () => {
  it('disables the type selector buttons when disabled=true', () => {
    render(<CommentsSection {...makeProps([], { disabled: true })} />);
    const questionBtn = screen.getByRole('radio', { name: /question/i });
    expect(questionBtn).toBeDisabled();
  });

  it('disables the textarea when disabled=true', () => {
    render(<CommentsSection {...makeProps([], { disabled: true })} />);
    const textarea = screen.getByRole('textbox', { name: /comment text/i });
    expect(textarea).toBeDisabled();
  });

  it('hides the resolve button when disabled=true', () => {
    render(<CommentsSection {...makeProps([QUESTION], { disabled: true })} />);
    expect(screen.queryByRole('button', { name: /mark as resolved/i })).toBeNull();
  });
});
