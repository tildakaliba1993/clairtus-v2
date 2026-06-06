'use client';

import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetchAuthConfig, browserSupabase, type AuthConfig } from '../lib/supabase';

/**
 * Self-serve signup/login via Supabase Auth. Reads its config at runtime from `/api/auth-config`
 * (server env — no rebuild needed). On a successful session it bridges to the API (`/api/signup`),
 * which provisions the tenant on first login and connects the dashboard.
 */
export function SignupForm(): ReactElement {
  const router = useRouter();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetchAuthConfig().then(setConfig);
  }, []);

  if (config === null) {
    return <div className="rounded-md border border-slate-200 bg-white p-5 text-sm text-muted">Loading…</div>;
  }

  if (!config.configured) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-5">
        <p className="text-sm text-foreground">Self-serve sign-up isn&apos;t enabled yet.</p>
        <p className="text-muted mt-1 text-sm">
          Already have an API key?{' '}
          <Link href="/connect" className="text-primary hover:underline">Connect it here</Link>.
        </p>
      </div>
    );
  }

  async function bridge(accessToken: string): Promise<void> {
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    });
    const body = await res.json();
    if (!res.ok) { setError(body.error ?? 'Sign-up failed'); return; }
    if (body.connected) router.push('/');
    else { setNotice('Welcome back — connect with one of your API keys.'); router.push('/keys'); }
  }

  async function submit(mode: 'signup' | 'login', e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!config?.configured) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const supabase = browserSupabase(config.url!, config.anonKey!);
      const { data, error: authErr } =
        mode === 'signup'
          ? await supabase.auth.signUp({ email, password })
          : await supabase.auth.signInWithPassword({ email, password });
      if (authErr) { setError(authErr.message); return; }
      const token = data.session?.access_token;
      if (!token) { setNotice('Check your email to confirm your account, then log in.'); return; }
      await bridge(token);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3 rounded-md border border-slate-200 bg-white p-5">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-foreground">{notice}</p>}
      <label className="block text-sm text-muted">
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <label className="block text-sm text-muted">
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <div className="flex gap-3">
        <button onClick={(e) => submit('signup', e)} disabled={busy}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          Create account
        </button>
        <button onClick={(e) => submit('login', e)} disabled={busy}
          className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-foreground disabled:opacity-50">
          Log in
        </button>
      </div>
    </form>
  );
}
