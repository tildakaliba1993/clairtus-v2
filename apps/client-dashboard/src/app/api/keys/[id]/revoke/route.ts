import { NextResponse } from 'next/server';
import { getKey } from '../../../../../lib/session';
import { makeClient } from '../../../../../lib/client';

/** Revoke one of the tenant's API keys. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const key = await getKey();
  if (!key) return NextResponse.json({ error: 'not connected' }, { status: 401 });
  const { id } = await ctx.params;
  try {
    await makeClient(key).apiKeys.revoke(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'failed to revoke key' }, { status: 400 });
  }
}
