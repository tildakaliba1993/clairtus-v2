import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { KEY_COOKIE } from '../../../lib/session';
import { apiBaseUrl } from '../../../lib/client';

/**
 * Bridge a Supabase session to a Clairtus tenant: forward the session JWT to the API's
 * `POST /v1/auth/signup` (which provisions a tenant + keys on first login), then store the tenant's
 * **test key** in the httpOnly cookie so the dashboard is connected immediately.
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

  if (body.testKey) {
    const jar = await cookies();
    jar.set(KEY_COOKIE, body.testKey, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }
  // For a returning user (no fresh key returned) the client routes them to /connect or /keys.
  return NextResponse.json({ ok: true, provisioned: body.provisioned, connected: Boolean(body.testKey) });
}
