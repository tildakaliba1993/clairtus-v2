'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetchAuthConfig, getSupabase, type AuthConfig } from '../lib/supabase';

/**
 * Self-serve signup/login via Supabase Auth. Reads config at runtime from `/api/auth-config`. Bridging
 * is driven by the **session** (not the button): whenever a session appears — right after a no-confirm
 * signup, after the email-confirmation redirect (detectSessionInUrl), or on login — it provisions the
 * tenant via `/api/signup` and connects the dashboard. Idempotent + robust to email confirmation.
 */
export function SignupForm(): ReactElement {
  const router = useRouter();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bridging = useRef(false);

  useEffect(() => {
    fetchAuthConfig().then(setConfig);
  }, []);

  const bridge = useCallback(async (accessToken: string): Promise<void> => {
    if (bridging.current) return;
    bridging.current = true;
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error ?? 'Sign-up failed'); bridging.current = false; return; }
      router.push(body.connected ? '/' : '/keys');
    } catch {
      setError('Could not reach the API.');
      bridging.current = false;
    }
  }, [router]);

  // Bridge whenever a session exists/arrives (post-confirmation redirect, login, or instant signup).
  useEffect(() => {
    if (!config?.configured) return;
    const supabase = getSupabase(config.url as string, config.anonKey as string);
    void supabase.auth.getSession().then(({ data }) => { if (data.session) void bridge(data.session.access_token); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => { if (session) void bridge(session.access_token); });
    return () => sub.subscription.unsubscribe();
  }, [config, bridge]);

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

  async function submit(mode: 'signup' | 'login', e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!config?.configured) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const supabase = getSupabase(config.url as string, config.anonKey as string);
      if (mode === 'signup') {
        const { data, error: authErr } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/signup` : undefined },
        });
        if (authErr) { setError(authErr.message); return; }
        if (!data.session) setNotice('Account created — check your email to confirm, then come back and log in.');
        // a returned session is handled by onAuthStateChange → bridge
      } else {
        const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
        if (authErr) setError(authErr.message);
        // success → onAuthStateChange → bridge
      }
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
        <button type="button" onClick={(e) => submit('signup', e)} disabled={busy}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          Create account
        </button>
        <button type="button" onClick={(e) => submit('login', e)} disabled={busy}
          className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-foreground disabled:opacity-50">
          Log in
        </button>
      </div>
    </form>
  );
}
