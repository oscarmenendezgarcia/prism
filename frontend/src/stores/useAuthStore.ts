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

api.setSignedOutHandler(() => useAuthStore.getState().signedOut());
