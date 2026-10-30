/**
 * The signed-in person's avatar, and what they can do with their account.
 */

import { useRef, useState } from 'react';
import { ContextMenu } from '@/components/shared/ContextMenu';
import { TeamModal } from '@/components/modals/TeamModal';
import { useAuthStore } from '@/stores/useAuthStore';
import { getGradient, getInitials } from '@/utils/avatar';

const ROLE_LABELS = { admin: 'Admin', member: 'Member', viewer: 'Viewer' };

export function UserMenu() {
  const user = useAuthStore((s) => s.status?.user);
  const signOut = useAuthStore((s) => s.signOut);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);

  if (!user) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Account: ${user.name}`}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        data-testid="user-menu"
        onClick={() => setAnchor(anchor ? null : buttonRef.current!.getBoundingClientRect())}
        className={`w-8 h-8 rounded-full bg-gradient-to-br ${getGradient(user.name)} flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface`}
      >
        {getInitials(user.name)}
      </button>
      <ContextMenu
        open={!!anchor}
        anchorRect={anchor}
        alignEnd
        heading={(
          <>
            <p className="text-sm font-semibold text-text-primary truncate max-w-[220px]">{user.name}</p>
            <p className="text-xs text-text-secondary">{ROLE_LABELS[user.role]}</p>
          </>
        )}
        items={[
          ...(user.role === 'admin' ? [{ id: 'team', label: 'Team', icon: 'group' }] : []),
          { id: 'sign-out', label: 'Sign out', icon: 'logout' },
        ]}
        onSelect={(id) => {
          if (id === 'team') setTeamOpen(true);
          if (id === 'sign-out') void signOut();
        }}
        onClose={() => setAnchor(null)}
      />
      {teamOpen && <TeamModal onClose={() => setTeamOpen(false)} />}
    </>
  );
}
