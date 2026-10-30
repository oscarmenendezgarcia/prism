/**
 * Shows the app to someone signed in, and otherwise the page that gets them there:
 * the first account, an invitation or reset link, or signing in.
 */

import React, { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { Button } from '@/components/shared/Button';
import { AccountLinkScreen, AuthLayout, SetupScreen, SignInScreen } from '@/components/auth/AuthScreens';

const LINK_PATH = /^\/(?:invite|reset)\/([^/]+)$/;

export function AuthGate({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const failed = useAuthStore((s) => s.failed);
  const load   = useAuthStore((s) => s.load);
  const [linkToken, setLinkToken] = useState(() => LINK_PATH.exec(window.location.pathname)?.[1] ?? null);

  useEffect(() => { void load(); }, [load]);

  /** Into the app, without the link in the address bar or the history. */
  const leaveLink = () => {
    window.history.replaceState(null, '', '/');
    setLinkToken(null);
  };

  if (failed) {
    return (
      <AuthLayout title="Can't reach the server" hint="Check that Prism is running.">
        <Button variant="primary" onClick={() => void load()}>Try again</Button>
      </AuthLayout>
    );
  }
  if (!status) return null;
  if (linkToken) return <AccountLinkScreen token={linkToken} onDone={leaveLink} />;
  if (status.needsSetup) return <SetupScreen />;
  if (!status.user) return <SignInScreen />;
  return <>{children}</>;
}
