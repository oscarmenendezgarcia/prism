/**
 * The API tokens of whoever is signed in, for scripts and MCP. They act as this person, never
 * above their role, and each is shown once.
 */

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/api/client';
import { Button } from '@/components/shared/Button';
import { Modal } from '@/components/shared/Modal';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import type { ApiToken } from '@/types';
import { formatRelativeTime } from '@/utils/formatRelativeTime';

const FIELD = 'bg-surface border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50';

const EXPIRY = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: 'A year' },
  { days: null, label: 'Never' },
];

export function TokensModal({ onClose }: { onClose: () => void }) {
  const isViewer = useAuthStore((s) => s.status?.user?.role === 'viewer');
  const showToast = useAppStore((s) => s.showToast);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [name, setName] = useState('');
  const [access, setAccess] = useState<ApiToken['access']>(isViewer ? 'read' : 'full');
  const [days, setDays] = useState<number | null>(90);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fail = useCallback((err: unknown) => {
    showToast(err instanceof Error ? err.message : 'That did not work.', 'error');
  }, [showToast]);

  const refresh = useCallback(() => api.getApiTokens().then(setTokens).catch(fail), [fail]);
  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    try {
      const created = await api.createApiToken({ name, access, days });
      setSecret(created.secret);
      setCopied(false);
      setName('');
      await refresh();
    } catch (err) {
      fail(err);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.deleteApiToken(id);
    } catch (err) {
      fail(err);
    }
    await refresh();
  };

  const copy = () => {
    if (secret) navigator.clipboard?.writeText(secret).then(() => setCopied(true)).catch(() => {});
  };

  return (
    <Modal open onClose={onClose} title="API tokens" maxWidth="max-w-2xl">
      <div className="p-5 max-h-[80vh] overflow-y-auto" data-testid="tokens-modal">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">API tokens</h2>
          <Button variant="icon" aria-label="Close" onClick={onClose}>
            <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">close</span>
          </Button>
        </div>
        <p className="mt-1 mb-4 text-sm text-text-secondary">
          For scripts and MCP: send it as <code className="font-mono text-xs">Authorization: Bearer …</code>, or set it as <code className="font-mono text-xs">PRISM_TOKEN</code>. It acts as you, so treat it like a password.
        </p>

        {secret && (
          <div className="mb-4 p-3 rounded-xl border border-primary/30 bg-primary/[0.06]" data-testid="token-secret">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-text-primary flex-1">Copy your new token now. You won't see it again.</p>
              <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setSecret(null)}>Done</button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input readOnly value={secret} aria-label="New token" data-testid="token-value" onFocus={(e) => e.target.select()} className={`${FIELD} flex-1 min-w-0 font-mono text-xs`} />
              <Button variant="secondary" size="sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
            </div>
          </div>
        )}

        <form className="flex flex-wrap items-center gap-2 mb-4" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <input
            required
            maxLength={50}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What it is for"
            aria-label="What the token is for"
            className={`${FIELD} flex-1 min-w-[160px]`}
          />
          {!isViewer && (
            <select value={access} onChange={(e) => setAccess(e.target.value as ApiToken['access'])} aria-label="Access" className={FIELD}>
              <option value="full">Full</option>
              <option value="read">Read only</option>
            </select>
          )}
          <select value={days ?? ''} onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)} aria-label="Expires" className={FIELD}>
            {EXPIRY.map((option) => <option key={option.label} value={option.days ?? ''}>{option.label}</option>)}
          </select>
          <Button type="submit" variant="primary" size="sm">New token</Button>
        </form>

        <ul className="flex flex-col divide-y divide-border/40 border-y border-border/40">
          {tokens.map((token) => (
            <li key={token.id} className="flex items-center gap-3 py-2.5" data-testid="token-row">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{token.name}</p>
                <p className="text-xs text-text-secondary truncate">
                  {token.access === 'read' ? 'Read only' : 'Full'}
                  {' · '}{token.lastUsedAt ? `Used ${formatRelativeTime(token.lastUsedAt)}` : 'Not used yet'}
                  {' · '}{token.expiresAt ? `Expires ${new Date(token.expiresAt).toLocaleDateString()}` : 'Never expires'}
                </p>
              </div>
              <button
                type="button"
                className="text-xs font-medium text-error hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
                aria-label={`Revoke ${token.name}`}
                onClick={() => { void revoke(token.id); }}
              >
                Revoke
              </button>
            </li>
          ))}
          {tokens.length === 0 && <li className="py-3 text-sm text-text-secondary">No tokens yet.</li>}
        </ul>
      </div>
    </Modal>
  );
}
