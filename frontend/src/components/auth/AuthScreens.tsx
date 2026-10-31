/**
 * The pages before the app: the first account, signing in, and invitation or reset links.
 */

import React, { useEffect, useState } from 'react';
import type { AccountLink, User } from '@/types';
import * as api from '@/api/client';
import { Button } from '@/components/shared/Button';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { useAuthStore } from '@/stores/useAuthStore';

const PASSWORD_HINT = 'At least 10 characters.';

const INPUT_CLASS =
  'w-full h-10 px-3 rounded-lg border border-border bg-surface text-sm text-text-primary placeholder:text-text-tertiary ' +
  'focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors duration-fast';

export function AuthLayout({ title, hint, children }: { title: string; hint?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <main className="relative min-h-full flex items-center justify-center p-4 bg-background">
      <div className="absolute top-3 right-3"><ThemeToggle /></div>
      <div className="w-full max-w-sm bg-surface-elevated border border-border rounded-2xl p-6">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 flex items-center justify-center rounded-lg bg-primary/10">
            <span className="text-primary text-sm font-bold leading-none select-none">◆</span>
          </div>
          <span className="text-lg font-semibold text-text-primary tracking-tight">Prism</span>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-text-primary">{title}</h1>
        {hint && <p className="mt-1 text-sm text-text-secondary">{hint}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </main>
  );
}

function Field({ label, hint, ...input }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = `auth-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <div className="mb-3">
      <label htmlFor={id} className="block mb-1 text-sm font-medium text-text-primary">{label}</label>
      <input id={id} className={INPUT_CLASS} required {...input} />
      {hint && <p className="mt-1 text-xs text-text-secondary">{hint}</p>}
    </div>
  );
}

/** A form that says what went wrong and can't be sent twice. */
function AuthForm({ submitLabel, onSubmit, children }: {
  submitLabel: string;
  onSubmit: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      {children}
      {error && <p role="alert" className="mb-3 text-sm text-error">{error}</p>}
      <Button type="submit" variant="primary" disabled={busy} className="w-full justify-center">{submitLabel}</Button>
    </form>
  );
}

/** The link the server prints carries the code, so that there is nothing to copy. */
function takeSetupCodeFromAddress(): string {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('setup') ?? '';
  if (code) {
    params.delete('setup');
    window.history.replaceState(null, '', `${window.location.pathname}${params.size > 0 ? `?${params}` : ''}`);
  }
  return code;
}

export function SetupScreen() {
  const signedIn = useAuthStore((s) => s.signedIn);
  const [codeFromLink] = useState(takeSetupCodeFromAddress);
  const [setupCode, setSetupCode] = useState(codeFromLink);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <AuthLayout title="Create the admin account" hint="You are the first one here. You can invite your team next.">
      <AuthForm
        submitLabel="Create account"
        onSubmit={async () => {
          const { user } = await api.setUp({ name, email, password, setupCode });
          signedIn(user);
        }}
      >
        {!codeFromLink && (
          <Field label="Setup code" hint="The server prints it when it starts. It is also in the file setup-code, in its data folder." autoComplete="off" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} />
        )}
        <Field label="Name" autoComplete="name" maxLength={50} value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="new-password" minLength={10} hint={PASSWORD_HINT} value={password} onChange={(e) => setPassword(e.target.value)} />
      </AuthForm>
    </AuthLayout>
  );
}

export function SignInScreen() {
  const signedIn = useAuthStore((s) => s.signedIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <AuthLayout title="Sign in">
      <AuthForm
        submitLabel="Sign in"
        onSubmit={async () => {
          const { user } = await api.signIn(email, password);
          signedIn(user);
        }}
      >
        <Field label="Email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </AuthForm>
      <p className="mt-3 text-xs text-text-secondary">Forgot your password? Ask an admin for a reset link.</p>
    </AuthLayout>
  );
}

const ROLE_LABELS: Record<NonNullable<User['role']>, string> = { admin: 'Admin', member: 'Member', viewer: 'Viewer' };

export function AccountLinkScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const signedIn = useAuthStore((s) => s.signedIn);
  const [link, setLink] = useState<AccountLink | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    api.getAccountLink(token).then(setLink).catch(() => setLink(null));
  }, [token]);

  if (link === undefined) return null;
  if (link === null) {
    return (
      <AuthLayout title="This link is not valid any more" hint="It may have been used or have expired. Ask an admin for a new one.">
        <Button variant="secondary" onClick={onDone}>Go to sign in</Button>
      </AuthLayout>
    );
  }

  const invite = link.kind === 'invite';
  const hint = invite
    ? <>Join as <strong>{link.role ? ROLE_LABELS[link.role] : ''}</strong> with {link.email}.</>
    : <>For {link.email}.</>;

  return (
    <AuthLayout title={invite ? `${link.createdBy} invited you` : 'Choose a new password'} hint={hint}>
      <AuthForm
        submitLabel={invite ? 'Join' : 'Save password'}
        onSubmit={async () => {
          const { user } = await api.redeemAccountLink(token, { ...(invite && { name }), password });
          signedIn(user);
          onDone();
        }}
      >
        {/* For password managers, which save the login under this. */}
        <input type="email" autoComplete="username" value={link.email} readOnly hidden />
        {invite && <Field label="Your name" autoComplete="name" maxLength={50} value={name} onChange={(e) => setName(e.target.value)} />}
        <Field label={invite ? 'Choose a password' : 'New password'} type="password" autoComplete="new-password" minLength={10} hint={PASSWORD_HINT} value={password} onChange={(e) => setPassword(e.target.value)} />
      </AuthForm>
    </AuthLayout>
  );
}
