import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/** httpOnly cookie holding the tenant API key — kept server-side, never exposed to client JS. */
export const KEY_COOKIE = 'clairtus_key';

export async function getKey(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(KEY_COOKIE)?.value ?? null;
}

/** For protected pages: returns the key or redirects to /connect. */
export async function requireKey(): Promise<string> {
  const key = await getKey();
  if (!key) redirect('/connect');
  return key;
}
