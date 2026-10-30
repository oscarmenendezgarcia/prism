/**
 * Who is signed in, and what the server needs before anyone can be.
 */

import { create } from 'zustand';
import type { AuthStatus, User } from '@/types';
import * as api from '@/api/client';
import { reloadPage } from '@/utils/reloadPage';

interface AuthState {
  /** Null until the server has answered. */
  status: AuthStatus | null;
  /** Could not reach the server. */
  failed: boolean;
  load: () => Promise<void>;
  /** Check again, for a role that changed. If it fails, things stay as they are. */
  refresh: () => Promise<void>;
  signedIn: (user: User) => void;
  signedOut: () => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: null,
  failed: false,

  load: async () => {
    set({ failed: false });
    try {
      set({ status: await api.getAuthStatus() });
    } catch {
      set({ failed: true });
    }
  },

  refresh: async () => {
    try {
      set({ status: await api.getAuthStatus() });
    } catch { /* Next time. */ }
  },

  signedIn: (user) => set({ status: { needsSetup: false, user } }),

  signedOut: () => {
    const { status } = get();
    if (!status?.user) return;
    set({ status: { ...status, user: null } });
    // Nothing of this person stays in memory for whoever signs in next. The address stays.
    reloadPage();
  },

  signOut: async () => {
    try {
      await api.signOut();
    } finally {
      // From the top, so that nothing of this person stays in memory.
      window.location.assign('/');
    }
  },
}));

/** May change issues. A page rendered with nobody signed in has nothing to protect. */
export const useCanEdit = () => useAuthStore((s) => s.status?.user?.role !== 'viewer');

/** May change spaces, the team and what runs on the server. */
export const useIsAdmin = () => useAuthStore((s) => {
  const role = s.status?.user?.role;
  return role === undefined || role === 'admin';
});

/** May delete this issue: an admin, or whoever created it. */
export const useCanDelete = (task: { createdBy?: string } | null | undefined) => useAuthStore((s) => {
  const user = s.status?.user;
  if (!user) return true;
  return user.role === 'admin' || (user.role === 'member' && !!task?.createdBy && task.createdBy === user.id);
});

