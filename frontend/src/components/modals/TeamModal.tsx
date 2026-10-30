/**
 * Who is on the team, for an admin: invite people, change their role, give them a link to set
 * a new password, or turn an account off. There is no email yet, so links are for copying.
 */

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/api/client';
import { Button } from '@/components/shared/Button';
import { Modal } from '@/components/shared/Modal';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import type { Invite, Role, User } from '@/types';
import { getGradient, getInitials } from '@/utils/avatar';
import { formatRelativeTime } from '@/utils/formatRelativeTime';

const ROLES: { id: Role; label: string }[] = [
  { id: 'admin', label: 'Admin' },
  { id: 'member', label: 'Member' },
  { id: 'viewer', label: 'Viewer' },
];

const FIELD = 'bg-surface border border-border rounded-lg px-2 py-1 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50';
const LINK = 'text-xs font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm whitespace-nowrap';
const DANGER_LINK = 'text-xs font-medium text-error hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm whitespace-nowrap';

/** A link to hand over. Without HTTPS the browser refuses to copy, and it can be selected by hand. */
function LinkBox({ title, path, note, onDismiss }: { title: string; path: string; note: string; onDismiss: () => void }) {
  const url = `${window.location.origin}${path}`;
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(url).then(() => setCopied(true)).catch(() => {});
  };
  return (
    <div className="mb-4 p-3 rounded-xl border border-primary/30 bg-primary/[0.06]" data-testid="link-box">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-text-primary flex-1 min-w-0 truncate">{title}</p>
        <button type="button" className={LINK} onClick={onDismiss}>Done</button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          readOnly
          value={url}
          aria-label="Link to share"
          data-testid="link-value"
          onFocus={(e) => e.target.select()}
          className={`${FIELD} flex-1 min-w-0 font-mono text-xs`}
        />
        <Button variant="secondary" size="sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
      <p className="mt-1.5 text-xs text-text-secondary">{note}</p>
    </div>
  );
}

export function TeamModal({ onClose }: { onClose: () => void }) {
  const me = useAuthStore((s) => s.status?.user);
  const showToast = useAppStore((s) => s.showToast);
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [link, setLink] = useState<{ title: string; path: string; note: string } | null>(null);

  const refresh = useCallback(async () => {
    const [people, pending] = await Promise.all([api.getUsers(), api.getInvites()]);
    setUsers(people);
    setInvites(pending);
    setLoaded(true);
  }, []);

  /** Run a change and show the team as it is now, whether it worked or not. */
  const change = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'That did not work.', 'error');
    }
    await refresh().catch(() => {});
  }, [refresh, showToast]);

  useEffect(() => {
    refresh().catch((err) => showToast(err instanceof Error ? err.message : 'Could not load the team.', 'error'));
  }, [refresh, showToast]);

  const invite = (inviteEmail: string, inviteRole: Role) => change(async () => {
    const created = await api.createInvite(inviteEmail, inviteRole);
    setLink({ title: `Invite link for ${created.email}`, path: created.path, note: 'Works once, for 7 days. Asking for a new one cancels this one.' });
    setEmail('');
  });

  const resetLink = (user: User) => change(async () => {
    const created = await api.createResetLink(user.id);
    setLink({ title: `New password for ${user.name}`, path: created.path, note: 'Works once, for a day. Using it signs them out everywhere else.' });
  });

  return (
    <Modal open onClose={onClose} title="Team" maxWidth="max-w-3xl">
      <div className="p-5 max-h-[80vh] overflow-y-auto" data-testid="team-modal">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Team</h2>
          <Button variant="icon" aria-label="Close" onClick={onClose}>
            <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">close</span>
          </Button>
        </div>

        {link && <LinkBox {...link} onDismiss={() => setLink(null)} />}

        <form
          className="flex flex-wrap items-center gap-2 mb-4"
          onSubmit={(e) => { e.preventDefault(); void invite(email, role); }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email of someone to invite"
            aria-label="Email to invite"
            className={`${FIELD} flex-1 min-w-[200px] py-1.5`}
          />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role of the new person" className={`${FIELD} py-1.5`}>
            {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <Button type="submit" variant="primary" size="sm">Invite</Button>
        </form>

        {loaded && (
          <ul className="flex flex-col divide-y divide-border/40 border-y border-border/40">
            {users.map((user) => (
              <li key={user.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 ${user.active ? '' : 'opacity-60'}`} data-testid="team-member">
                <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${getGradient(user.name)} flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0`} aria-hidden="true">
                  {getInitials(user.name)}
                </div>
                <div className="flex-1 min-w-[160px]">
                  <p className="text-sm font-medium text-text-primary truncate">{user.name}{user.id === me?.id ? ' (you)' : ''}</p>
                  <p className="text-xs text-text-secondary truncate">
                    {user.email}
                    {!user.active ? ' · Deactivated' : user.lastSeenAt ? ` · Seen ${formatRelativeTime(user.lastSeenAt)}` : ''}
                  </p>
                </div>
                <select
                  value={user.role}
                  disabled={!user.active}
                  aria-label={`Role of ${user.name}`}
                  onChange={(e) => { void change(() => api.updateUser(user.id, { role: e.target.value as Role })); }}
                  className={FIELD}
                >
                  {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                <div className="flex items-center gap-3 sm:w-44 sm:justify-end">
                  {user.active && <button type="button" className={LINK} onClick={() => { void resetLink(user); }}>Reset link</button>}
                  {user.id !== me?.id && (
                    user.active
                      ? <button type="button" className={DANGER_LINK} onClick={() => { void change(() => api.updateUser(user.id, { active: false })); }}>Deactivate</button>
                      : <button type="button" className={LINK} onClick={() => { void change(() => api.updateUser(user.id, { active: true })); }}>Reactivate</button>
                  )}
                </div>
              </li>
            ))}
            {invites.map((pending) => (
              <li key={pending.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5" data-testid="team-invite">
                <div className="w-8 h-8 rounded-full border border-dashed border-border flex items-center justify-center text-text-secondary flex-shrink-0" aria-hidden="true">
                  <span className="material-symbols-outlined text-base leading-none">mail</span>
                </div>
                <div className="flex-1 min-w-[160px]">
                  <p className="text-sm text-text-primary truncate">{pending.email}</p>
                  <p className="text-xs text-text-secondary">Invited as {ROLES.find((r) => r.id === pending.role)?.label}</p>
                </div>
                <div className="flex items-center gap-3 sm:w-44 sm:justify-end">
                  <button type="button" className={LINK} onClick={() => { void invite(pending.email, pending.role); }}>New link</button>
                  <button type="button" className={DANGER_LINK} onClick={() => { void change(() => api.deleteInvite(pending.id)); }}>Cancel</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
