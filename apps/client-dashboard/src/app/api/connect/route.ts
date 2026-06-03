import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { KEY_COOKIE } from '../../../lib/session';
import { makeClient } from '../../../lib/client';

/** Validate the API key by calling the API, then store it in an httpOnly cookie. */
export async function POST(req: Request): Promise<NextResponse> {
  const { apiKey } = (await req.json().catch(() => ({}))) as { apiKey?: string };
  if (!apiKey || typeof apiKey !== 'string') {
    return NextResponse.json({ error: 'API key is required' }, { status: 400 });
  }
  try {
    await makeClient(apiKey).balances(); // verifies the key authenticates against the API
  } catch {
    return NextResponse.json({ error: 'Invalid API key, or the API is unreachable' }, { status: 401 });
  }
  const jar = await cookies();
  jar.set(KEY_COOKIE, apiKey, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  return NextResponse.json({ ok: true });
}
