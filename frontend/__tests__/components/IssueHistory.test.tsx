import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { IssueHistory } from '../../src/components/board/IssueHistory';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { getTaskHistory } from '../../src/api/client';
import type { HistoryEntry } from '../../src/types';

vi.mock('../../src/api/client', () => ({ getTaskHistory: vi.fn() }));

useAuthStore.setState({ status: { needsSetup: false, user: { id: 'u', name: 'user', email: '', role: 'admin', active: true } } });

const entry = (field: string, oldValue: string | null, newValue: string | null, actor = 'user', id = 1): HistoryEntry => (
  { id, actor, field, oldValue, newValue, createdAt: '2026-01-01T00:00:00.000Z' }
);

async function lineFor(e: HistoryEntry): Promise<string> {
  vi.mocked(getTaskHistory).mockResolvedValue({ history: [e] });
  render(<IssueHistory spaceId="s1" taskId="t1" />);
  const line = await screen.findByTestId('history-entry');
  // Without the time at the end of the line.
  return line.querySelector('span')!.textContent!;
}

beforeEach(() => {
  vi.mocked(getTaskHistory).mockReset();
});

describe('IssueHistory — lines', () => {
  it.each([
    ['created', null, null, 'You created it'],
    ['description', 'old', 'new', 'You changed the description'],
    ['assigned', null, 'Ana', 'You assigned it to Ana'],
    ['assigned', 'Ana', 'Bea', 'You assigned it to Bea'],
    ['assigned', 'Ana', null, 'You unassigned it'],
    ['status', 'Todo', 'In review', 'You changed status Todo → In review'],
    ['priority', 'low', 'urgent', 'You changed priority Low → Urgent'],
    ['type', 'bug', 'chore', 'You changed type bug → chore'],
    ['title', 'Old', 'New', 'You changed title Old → New'],
    ['labels', 'a, b', 'a', 'You changed labels a, b → a'],
    ['labels', 'a', null, 'You changed labels a to none'],
    ['estimate', null, '3', 'You changed estimate 3'],
    ['estimate', '0', '3', 'You changed estimate 0 → 3'],
    ['dueDate', '2020-03-04', '2021-05-06', 'You changed due date Mar 4, 2020 → May 6, 2021'],
    ['dueDate', '2020-03-04', null, 'You changed due date Mar 4, 2020 to none'],
    ['parentId', 'WEB-1', 'WEB-2', 'You changed parent WEB-1 → WEB-2'],
    ['parentId', 'WEB-1', null, 'You changed parent WEB-1 to none'],
    ['dependsOn', null, 'WEB-3, WEB-4', 'You changed dependencies WEB-3, WEB-4'],
    ['somethingNew', 'x', 'y', 'You changed somethingNew x → y'],
  ])('%s from %s to %s', async (field, oldValue, newValue, expected) => {
    expect(await lineFor(entry(field, oldValue, newValue))).toBe(expected);
  });
});

describe('IssueHistory — actor', () => {
  it('says You for whoever is signed in', async () => {
    expect(await lineFor(entry('created', null, null, 'user'))).toMatch(/^You /);
  });

  it('names anyone else', async () => {
    expect(await lineFor(entry('created', null, null, 'Claude'))).toBe('Claude created it');
  });
});

describe('IssueHistory — list', () => {
  it('keeps the order the server gives, one line each, with the time', async () => {
    vi.mocked(getTaskHistory).mockResolvedValue({
      history: [entry('title', 'a', 'b', 'user', 2), entry('created', null, null, 'Claude', 1)],
    });
    render(<IssueHistory spaceId="s1" taskId="t1" />);
    const lines = await screen.findAllByTestId('history-entry');
    expect(lines.map((l) => l.querySelector('span')!.textContent)).toEqual(['You changed title a → b', 'Claude created it']);
    expect(lines[0].querySelector('time')).toHaveAttribute('datetime', '2026-01-01T00:00:00.000Z');
    expect(getTaskHistory).toHaveBeenCalledWith('s1', 't1');
  });

  it('says it is loading until the answer comes', () => {
    vi.mocked(getTaskHistory).mockReturnValue(new Promise(() => {}));
    render(<IssueHistory spaceId="s1" taskId="t1" />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('says so when there is nothing recorded', async () => {
    vi.mocked(getTaskHistory).mockResolvedValue({ history: [] });
    render(<IssueHistory spaceId="s1" taskId="t1" />);
    expect(await screen.findByText(/Nothing recorded yet/)).toBeInTheDocument();
  });

  it('says so when it cannot load', async () => {
    vi.mocked(getTaskHistory).mockRejectedValue(new Error('down'));
    render(<IssueHistory spaceId="s1" taskId="t1" />);
    expect(await screen.findByText('Could not load the history.')).toBeInTheDocument();
    expect(screen.queryByTestId('issue-history')).not.toBeInTheDocument();
  });

  it('loads again when the issue changes, and recovers from a failure', async () => {
    vi.mocked(getTaskHistory).mockRejectedValueOnce(new Error('down'));
    const { rerender } = render(<IssueHistory spaceId="s1" taskId="t1" version="v1" />);
    await screen.findByText('Could not load the history.');
    vi.mocked(getTaskHistory).mockResolvedValue({ history: [entry('created', null, null)] });
    rerender(<IssueHistory spaceId="s1" taskId="t1" version="v2" />);
    expect(await screen.findByTestId('history-entry')).toBeInTheDocument();
    expect(screen.queryByText('Could not load the history.')).not.toBeInTheDocument();
    expect(getTaskHistory).toHaveBeenCalledTimes(2);
  });

  it('does not load again when nothing changed', async () => {
    vi.mocked(getTaskHistory).mockResolvedValue({ history: [] });
    const { rerender } = render(<IssueHistory spaceId="s1" taskId="t1" version="v1" />);
    await waitFor(() => expect(getTaskHistory).toHaveBeenCalledTimes(1));
    rerender(<IssueHistory spaceId="s1" taskId="t1" version="v1" />);
    expect(getTaskHistory).toHaveBeenCalledTimes(1);
  });

  it('ignores a failure for an issue no longer shown', async () => {
    let rejectFirst!: (e: Error) => void;
    vi.mocked(getTaskHistory).mockReturnValueOnce(new Promise((_, reject) => { rejectFirst = reject; }));
    const { rerender } = render(<IssueHistory spaceId="s1" taskId="t1" />);
    vi.mocked(getTaskHistory).mockResolvedValueOnce({ history: [entry('title', 'x', 'second')] });
    rerender(<IssueHistory spaceId="s1" taskId="t2" />);
    await screen.findByText(/second/);
    rejectFirst(new Error('down'));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('Could not load the history.')).not.toBeInTheDocument();
    expect(screen.getByTestId('history-entry')).toHaveTextContent('second');
  });

  it('ignores the answer for an issue no longer shown', async () => {
    let resolveFirst!: (v: { history: HistoryEntry[] }) => void;
    vi.mocked(getTaskHistory).mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }));
    const { rerender } = render(<IssueHistory spaceId="s1" taskId="t1" />);
    vi.mocked(getTaskHistory).mockResolvedValueOnce({ history: [entry('title', 'x', 'second')] });
    rerender(<IssueHistory spaceId="s1" taskId="t2" />);
    await screen.findByText(/second/);
    resolveFirst({ history: [entry('title', 'x', 'first')] });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId('history-entry')).toHaveTextContent('second');
    expect(screen.queryByText(/first/)).not.toBeInTheDocument();
  });
});
