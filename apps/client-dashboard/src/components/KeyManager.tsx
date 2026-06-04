'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import type { ApiKey } from '../lib/types';
import { ModeBadge } from './ModeBadge';

const ALL_SCOPES = ['escrows:write', 'parties:write', 'payouts:write', 'kyc:write', 'keys:read', 'keys:write'];

/** Tenant API-key management UI: list, create (one-time secret), revoke. Drives the /api/keys routes. */
export function KeyManager({ initialKeys }: { initialKeys: ApiKey[] }): ReactElement {
  const [keys, setKeys] = useState<ApiKey[]>(initialKeys);
  const [mode, setMode] = useState<'test' | 'live'>('test');
  const [scopes, setScopes] = useState<string[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const res = await fetch('/api/keys');
    if (res.ok) setKeys((await res.json()) as ApiKey[]);
  }

  async function create(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSecret(null);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, scopes }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error ?? 'Failed to create key'); return; }
      setSecret(body.plaintext as string);
      setScopes([]);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/keys/${id}/revoke`, { method: 'POST' });
      if (!res.ok) { setError('Failed to revoke key'); return; }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const toggleScope = (s: string) =>
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <div className="space-y-6">
      {secret && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-4">
          <p className="text-sm font-medium text-foreground">New API key — copy it now, it won&apos;t be shown again:</p>
          <code className="mt-2 block break-all rounded bg-white px-3 py-2 font-mono text-sm">{secret}</code>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <form onSubmit={create} className="rounded-md border border-slate-200 bg-white p-4">
        <h2 className="font-heading mb-3 text-sm font-semibold text-foreground">Create a key</h2>
        <div className="flex flex-wrap items-center gap-4">
          <label className="text-sm text-muted">
            Mode{' '}
            <select value={mode} onChange={(e) => setMode(e.target.value as 'test' | 'live')} className="rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="test">test (sandbox)</option>
              <option value="live">live (production)</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-3">
            {ALL_SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-1 text-sm text-muted">
                <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggleScope(s)} aria-label={s} />
                <span className="font-mono text-xs">{s}</span>
              </label>
            ))}
          </div>
          <button type="submit" disabled={busy} className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            Create key
          </button>
        </div>
      </form>

      {keys.length === 0 ? (
        <p className="text-muted text-sm">No keys yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-muted border-b border-slate-200 text-xs uppercase tracking-wide">
            <tr>
              <th className="py-2 pr-4 font-medium">Key</th>
              <th className="py-2 pr-4 font-medium">Mode</th>
              <th className="py-2 pr-4 font-medium">Scopes</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-b border-slate-100">
                <td className="py-2 pr-4 font-mono">…{k.last4}</td>
                <td className="py-2 pr-4"><ModeBadge mode={k.mode === 'live' ? 'live' : 'sandbox'} /></td>
                <td className="text-muted py-2 pr-4 font-mono text-xs">{k.scopes.join(', ') || '—'}</td>
                <td className="py-2 pr-4">{k.active ? <span className="text-primary">active</span> : <span className="text-muted">revoked</span>}</td>
                <td className="py-2 pr-4 text-right">
                  {k.active && (
                    <button onClick={() => revoke(k.id)} disabled={busy} className="text-sm text-red-600 hover:underline disabled:opacity-50">
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
