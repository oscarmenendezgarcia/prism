import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthGate } from '../../src/components/auth/AuthGate';
import { useAuthStore } from '../../src/stores/useAuthStore';
import * as api from '../../src/api/client';
import type { AuthStatus, User } from '../../src/types';

const ANA: User = { id: 'u1', name: 'Ana López', email: 'ana@example.com', role: 'admin', active: true };
const status = (over: Partial<AuthStatus> = {}): AuthStatus => ({ needsSetup: false, setupCodeRequired: false, user: null, ...over });

function renderGate() {
  return render(<AuthGate><p>The board</p></AuthGate>);
}

const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ status: null, failed: false });
  window.history.replaceState(null, '', '/');
});

describe('AuthGate', () => {
  it('shows nothing until the server answers, and the app to someone signed in', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(status({ user: ANA }));
    renderGate();
    expect(screen.queryByText('The board')).not.toBeInTheDocument();
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
    expect(await screen.findByText('The board')).toBeInTheDocument();
  });

  it('asks to sign in, and lets in with the right password', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(status());
    const signIn = vi.spyOn(api, 'signIn').mockResolvedValue({ user: ANA });
    renderGate();
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByText('The board')).not.toBeInTheDocument();
    type('Email', 'ana@example.com');
    type('Password', 'correct horse');
    submit(/^sign in$/i);
    expect(await screen.findByText('The board')).toBeInTheDocument();
    expect(signIn).toHaveBeenCalledWith('ana@example.com', 'correct horse');
  });

  it('says what went wrong, and lets you try again', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(status());
    vi.spyOn(api, 'signIn').mockRejectedValueOnce(new api.ApiError('Wrong email or password.', 401, 'INVALID_CREDENTIALS'));
    renderGate();
    await screen.findByRole('heading', { name: 'Sign in' });
    type('Email', 'ana@example.com');
    type('Password', 'nope nope nope');
    submit(/^sign in$/i);
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeEnabled();
  });

  it('makes the first account, without a code on loopback', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(status({ needsSetup: true }));
    const setUp = vi.spyOn(api, 'setUp').mockResolvedValue({ user: ANA });
    renderGate();
    await screen.findByRole('heading', { name: /create the admin account/i });
    expect(screen.queryByLabelText('Setup code')).not.toBeInTheDocument();
    type('Name', 'Ana López');
    type('Email', 'ana@example.com');
    type('Password', 'correct horse');
    submit(/create account/i);
    expect(await screen.findByText('The board')).toBeInTheDocument();
    expect(setUp).toHaveBeenCalledWith({ name: 'Ana López', email: 'ana@example.com', password: 'correct horse' });
  });

  it('asks the setup code where the server needs it', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(status({ needsSetup: true, setupCodeRequired: true }));
    const setUp = vi.spyOn(api, 'setUp').mockResolvedValue({ user: ANA });
    renderGate();
    type(await screen.findByLabelText('Setup code').then(() => 'Setup code'), 'abc');
    type('Name', 'A');
    type('Email', 'a@b.c');
    type('Password', 'correct horse');
    submit(/create account/i);
    await waitFor(() => expect(setUp).toHaveBeenCalledWith(expect.objectContaining({ setupCode: 'abc' })));
  });

  it('accepts an invitation, and takes the link out of the address bar', async () => {
    window.history.replaceState(null, '', '/invite/tok123');
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(status());
    vi.spyOn(api, 'getAccountLink').mockResolvedValue({ kind: 'invite', email: 'bea@example.com', role: 'member', createdBy: 'Ana López' });
    const redeem = vi.spyOn(api, 'redeemAccountLink').mockResolvedValue({ user: { ...ANA, name: 'Bea' } });
    renderGate();
    await screen.findByRole('heading', { name: 'Ana López invited you' });
    expect(screen.getByText('Member')).toBeInTheDocument();
    type('Your name', 'Bea');
    type('Choose a password', 'correct horse');
    submit(/join/i);
    expect(await screen.findByText('The board')).toBeInTheDocument();
    expect(redeem).toHaveBeenCalledWith('tok123', { name: 'Bea', password: 'correct horse' });
    expect(window.location.pathname).toBe('/');
  });

  it('sets a new password from a reset link, even with no name asked', async () => {
    window.history.replaceState(null, '', '/reset/tok456');
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(status());
    vi.spyOn(api, 'getAccountLink').mockResolvedValue({ kind: 'reset', email: 'ana@example.com', role: null, createdBy: 'Bea' });
    const redeem = vi.spyOn(api, 'redeemAccountLink').mockResolvedValue({ user: ANA });
    renderGate();
    await screen.findByRole('heading', { name: 'Choose a new password' });
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
    type('New password', 'correct horse');
    submit(/save password/i);
    expect(await screen.findByText('The board')).toBeInTheDocument();
    expect(redeem).toHaveBeenCalledWith('tok456', { password: 'correct horse' });
  });

  it('a link takes priority over a session, so it can be used while signed in', async () => {
    window.history.replaceState(null, '', '/reset/tok456');
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(status({ user: ANA }));
    vi.spyOn(api, 'getAccountLink').mockResolvedValue({ kind: 'reset', email: 'ana@example.com', role: null, createdBy: 'Bea' });
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
  });

  it('says so when a link no longer works, and goes on to sign in', async () => {
    window.history.replaceState(null, '', '/invite/old');
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(status());
    vi.spyOn(api, 'getAccountLink').mockRejectedValue(new api.ApiError('gone', 404, 'LINK_INVALID'));
    renderGate();
    await screen.findByRole('heading', { name: /not valid any more/i });
    submit(/go to sign in/i);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('offers to try again if the server cannot be reached', async () => {
    const get = vi.spyOn(api, 'getAuthStatus').mockRejectedValueOnce(new Error('down')).mockResolvedValue(status({ user: ANA }));
    renderGate();
    await screen.findByRole('heading', { name: /can't reach the server/i });
    submit(/try again/i);
    expect(await screen.findByText('The board')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('goes back to sign in when a session ends while using the app, and keeps the place', async () => {
    window.history.replaceState(null, '', '/?issue=WEB-1');
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(status({ user: ANA }));
    renderGate();
    await screen.findByText('The board');
    useAuthStore.getState().signedOut();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(window.location.search).toBe('?issue=WEB-1');
  });

  it('any request that finds the session gone signs out', async () => {
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue(status({ user: ANA }));
    renderGate();
    await screen.findByText('The board');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }), { status: 401 }));
    await expect(api.getSpaces()).rejects.toThrow();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
