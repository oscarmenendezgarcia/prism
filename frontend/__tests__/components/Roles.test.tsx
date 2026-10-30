import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Header } from '../../src/components/layout/Header';
import { TaskCard } from '../../src/components/board/TaskCard';
import { TeamModal } from '../../src/components/modals/TeamModal';
import { UserMenu } from '../../src/components/layout/UserMenu';
import { CommentsSection } from '../../src/components/board/CommentsSection';
import { BoardEmptyState } from '../../src/components/board/BoardEmptyState';
import { SpaceTabs } from '../../src/components/layout/SpaceTabs';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { useAppStore } from '../../src/stores/useAppStore';
import * as api from '../../src/api/client';
import type { Role, Task, User } from '../../src/types';

const person = (role: Role, id = 'me'): User => ({ id, name: 'Ana López', email: 'ana@example.com', role, active: true });
const signIn = (role: Role) => useAuthStore.setState({ status: { needsSetup: false, user: person(role) }, failed: false });

const TASK: Task = { id: 't1', key: 'WEB-1', title: 'An issue', type: 'chore', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } as Task;

beforeEach(() => {
  vi.restoreAllMocks();
  useAppStore.setState({ spaces: [], activeSpaceId: 'default', showToast: vi.fn() } as never);
});

describe('what each role sees', () => {
  it('a viewer gets no New issue, and an empty board offers nothing to add', () => {
    signIn('viewer');
    render(<><Header /><BoardEmptyState onCreateTask={() => {}} /></>);
    expect(screen.queryByRole('button', { name: /add new issue/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add your first task/i })).not.toBeInTheDocument();
  });

  it('a member gets New issue', () => {
    signIn('member');
    render(<Header />);
    expect(screen.getByRole('button', { name: /add new issue/i })).toBeInTheDocument();
  });

  it('a viewer cannot drag a card or see its actions', () => {
    signIn('viewer');
    render(<TaskCard task={TASK} column="todo" />);
    expect(screen.getByTestId('task-card')).toHaveAttribute('draggable', 'false');
    expect(screen.queryByTestId('hover-overlay')).not.toBeInTheDocument();
  });

  it.each([
    ['member', { createdBy: 'me' }, true],
    ['member', { createdBy: 'someone' }, false],
    ['member', {}, false],
    ['admin', { createdBy: 'someone' }, true],
    ['admin', {}, true],
  ] as const)('a %s with %j can delete: %s', (role, over, expected) => {
    signIn(role);
    render(<TaskCard task={{ ...TASK, ...over }} column="todo" />);
    expect(screen.queryAllByRole('button', { name: /delete/i }).length > 0).toBe(expected);
  });

  it('a viewer reads comments and cannot write one', () => {
    signIn('viewer');
    const props = { spaceId: 's', taskId: 't', onCommentCreated: vi.fn(), onCommentUpdated: vi.fn(), onAnswerQuestion: vi.fn() };
    const comments = [{ id: 'c', author: 'Bea', text: 'Which one?', type: 'question' as const, resolved: false, createdAt: '2026-01-01T00:00:00Z' }];
    render(<CommentsSection {...props} comments={comments} />);
    expect(screen.getByText('Which one?')).toBeInTheDocument();
    expect(screen.queryByTestId('add-comment-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('answer-form')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resolve/i })).not.toBeInTheDocument();
  });

  it('only an admin finds Team in the menu', () => {
    signIn('member');
    render(<UserMenu />);
    fireEvent.click(screen.getByTestId('user-menu'));
    expect(screen.queryByRole('menuitem', { name: /team/i })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
  });
});

describe('the tabs of spaces', () => {
  const SPACE = { id: 's', name: 'Web', pinned: true, createdAt: '', updatedAt: '' };
  beforeEach(() => useAppStore.setState({ spaces: [SPACE], activeSpaceId: 's' } as never));

  it('offer options to an admin only', () => {
    signIn('member');
    const { unmount } = render(<SpaceTabs />);
    expect(screen.queryByRole('button', { name: 'Space options' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create new space/i })).not.toBeInTheDocument();
    unmount();
    signIn('admin');
    render(<SpaceTabs />);
    expect(screen.queryAllByRole('button', { name: /create new space/i }).length).toBeGreaterThan(0);
  });
});

describe('TeamModal', () => {
  const mockTeam = (users: User[] = [person('admin'), { ...person('member', 'b'), name: 'Bea Ruiz', email: 'bea@example.com' }]) => {
    vi.spyOn(api, 'getUsers').mockResolvedValue(users);
    vi.spyOn(api, 'getInvites').mockResolvedValue([{ id: 'i', email: 'dani@example.com', role: 'viewer', expiresAt: '2030-01-01T00:00:00Z' }]);
  };

  beforeEach(() => signIn('admin'));

  it('lists people and invitations, and you cannot deactivate yourself', async () => {
    mockTeam();
    render(<TeamModal onClose={() => {}} />);
    expect(await screen.findByText('Bea Ruiz')).toBeInTheDocument();
    expect(screen.getByText('Ana López (you)')).toBeInTheDocument();
    expect(screen.getByText('dani@example.com')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Deactivate' })).toHaveLength(1);
  });

  it('inviting shows a whole link to hand over', async () => {
    mockTeam();
    const create = vi.spyOn(api, 'createInvite').mockResolvedValue({ id: 'n', email: 'eva@example.com', role: 'member', expiresAt: '', path: '/invite/tok' });
    render(<TeamModal onClose={() => {}} />);
    await screen.findByText('Bea Ruiz');
    fireEvent.change(screen.getByLabelText('Email to invite'), { target: { value: 'eva@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('eva@example.com', 'member'));
    expect(await screen.findByTestId('link-value')).toHaveValue(`${window.location.origin}/invite/tok`);
  });

  it('a new link for a pending invitation keeps its email and role', async () => {
    mockTeam();
    const create = vi.spyOn(api, 'createInvite').mockResolvedValue({ id: 'n', email: 'dani@example.com', role: 'viewer', expiresAt: '', path: '/invite/tok2' });
    render(<TeamModal onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New link' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('dani@example.com', 'viewer'));
  });

  it('changes a role, and says why if the server refuses', async () => {
    mockTeam();
    const update = vi.spyOn(api, 'updateUser').mockRejectedValue(new api.ApiError('This is the last admin.', 409, 'LAST_ADMIN'));
    const showToast = vi.fn();
    useAppStore.setState({ showToast } as never);
    render(<TeamModal onClose={() => {}} />);
    expect(await screen.findByLabelText('Role of Ana López')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Role of Bea Ruiz'), { target: { value: 'viewer' } });
    await waitFor(() => expect(update).toHaveBeenCalledWith('b', { role: 'viewer' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('This is the last admin.', 'error'));
    await waitFor(() => expect(screen.getByLabelText('Role of Bea Ruiz')).toHaveValue('member'));
  });

  it('a deactivated account can come back', async () => {
    mockTeam([person('admin'), { ...person('member', 'b'), name: 'Bea Ruiz', active: false }]);
    const update = vi.spyOn(api, 'updateUser').mockResolvedValue(person('member', 'b'));
    render(<TeamModal onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('b', { active: true }));
  });
});
