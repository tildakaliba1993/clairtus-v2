'use client';

import { useState, type FormEvent, type ReactElement } from 'react';

/** Client-side form: posts the API key to /api/connect, which validates + sets the cookie. */
export function ConnectForm(): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setPending(true);
    setError(null);
    const apiKey = String(new FormData(e.currentTarget).get('apiKey') ?? '').trim();
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    if (res.ok) {
      window.location.href = '/';
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setError(body.error ?? 'Could not connect');
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-foreground">API key</span>
        <input
          name="apiKey"
          type="password"
          placeholder="ck_test_…"
          autoComplete="off"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {pending ? 'Connecting…' : 'Connect'}
      </button>
    </form>
  );
}
