import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { KEY_COOKIE } from '../../../lib/session';

export async function POST(req: Request): Promise<NextResponse> {
  const jar = await cookies();
  jar.delete(KEY_COOKIE);
  return NextResponse.redirect(new URL('/connect', req.url));
}
