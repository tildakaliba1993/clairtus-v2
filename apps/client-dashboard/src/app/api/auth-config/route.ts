import { NextResponse } from 'next/server';

/**
 * Runtime Supabase Auth config for the browser. Read **at request time** from server env (no rebuild
 * needed to flip, and no NEXT_PUBLIC build-inlining gotcha). The anon key is the public/anon key — safe
 * to expose to the browser (that's its purpose). Falls back to the legacy NEXT_PUBLIC_* names.
 *
 * Diagnostic: `curl https://<dashboard>/api/auth-config` → `{ "configured": true|false }`.
 */
export function GET(): NextResponse {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.json({ configured: false });
  return NextResponse.json({ configured: true, url, anonKey });
}
