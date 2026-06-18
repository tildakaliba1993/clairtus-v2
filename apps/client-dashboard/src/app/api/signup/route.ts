import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { KEY_COOKIE } from '../../../lib/session';
import { apiBaseUrl } from '../../../lib/client';

/** Scopes a self-serve dashboard key needs to drive the tenant (matches the API's default owner set). */
const DASHBOARD_KEY_SCOPES = ['escrows:write', 'parties:write', 'payouts:write', 'kyc:write', 'keys:read', 'keys:write'];

/**
 * Bridge a Supabase session to a connected Clairtus dashboard:
 *  1. Forward the session JWT to the API's `POST /v1/auth/signup` (provisions tenant + keys on first login).
 *  2. First signup → store the freshly returned **test key** in the httpOnly cookie → connected.
 *  3. Returning user (no fresh key) → if no key cookie exists yet, **mint one via the session token**
 *     (the API now authenticates session JWTs, B8) so a returning user reconnects without pasting a key.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const { accessToken } = (await req.json().catch(() => ({}))) as { accessToken?: string };
  if (!accessToken) return NextResponse.json({ error: 'accessToken is required' }, { status: 400 });

  const res = await fetch(`${apiBaseUrl()}/auth/signup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return NextResponse.json({ error: 'sign-up failed' }, { status: res.status });
  const body = (await res.json()) as { provisioned: boolean; testKey?: string };

  const jar = await cookies();
  let key: string | null = body.testKey ?? null;

  if (!key) {
    // Returning user. Reuse an existing connection if present; otherwise mint a fresh test key via the
    // session so the dashboard reconnects (fixes the B8 "returning user with no key cookie" dead-end).
    if (jar.get(KEY_COOKIE)?.value) {
      return NextResponse.json({ ok: true, provisioned: body.provisioned, connected: true });
    }
    const minted = await fetch(`${apiBaseUrl()}/keys`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'test', scopes: DASHBOARD_KEY_SCOPES }),
    });
    if (minted.ok) key = ((await minted.json()) as { plaintext?: string }).plaintext ?? null;
  }

  if (key) {
    jar.set(KEY_COOKIE, key, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }
  return NextResponse.json({ ok: true, provisioned: body.provisioned, connected: Boolean(key) });
}
