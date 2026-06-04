import { NextResponse } from 'next/server';
import { getKey } from '../../../lib/session';
import { makeClient } from '../../../lib/client';

/** List the tenant's API keys (metadata only). */
export async function GET(): Promise<NextResponse> {
  const key = await getKey();
  if (!key) return NextResponse.json({ error: 'not connected' }, { status: 401 });
  try {
    const keys = await makeClient(key).apiKeys.list();
    return NextResponse.json(keys);
  } catch {
    return NextResponse.json({ error: 'failed to list keys (needs keys:read)' }, { status: 403 });
  }
}

/** Mint a new API key. The plaintext is returned ONCE. */
export async function POST(req: Request): Promise<NextResponse> {
  const key = await getKey();
  if (!key) return NextResponse.json({ error: 'not connected' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { mode?: 'test' | 'live'; scopes?: string[] };
  if (body.mode !== 'test' && body.mode !== 'live') {
    return NextResponse.json({ error: 'mode must be test or live' }, { status: 400 });
  }
  try {
    const created = await makeClient(key).apiKeys.create({ mode: body.mode, scopes: body.scopes ?? [] });
    return NextResponse.json(created);
  } catch {
    return NextResponse.json({ error: 'failed to create key (needs keys:write)' }, { status: 403 });
  }
}
