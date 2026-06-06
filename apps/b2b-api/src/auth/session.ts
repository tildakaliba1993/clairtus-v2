import { createHmac, timingSafeEqual } from 'node:crypto';

/** DI token for the session-token verifier (Supabase in prod, a fake in tests; null = self-serve off). */
export const AUTH_VERIFIER = 'AUTH_VERIFIER';

/** The identity carried by a verified session token. */
export interface SessionUser {
  userId: string;
  email?: string;
}

/** Verifies an opaque session token (e.g. a Supabase JWT) into a SessionUser, or null if invalid. */
export interface AuthVerifier {
  verify(token: string): Promise<SessionUser | null>;
}

const b64urlToBuf = (s: string): Buffer => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Verifies a Supabase **HS256** JWT with the project JWT secret (`SUPABASE_JWT_SECRET`): checks the
 * signature + expiry, then returns `{ userId: sub, email }`. (Asymmetric/JWKS Supabase keys would need a
 * JWKS verifier — a future add.)
 */
export class SupabaseJwtVerifier implements AuthVerifier {
  constructor(private readonly secret: string) {}

  async verify(token: string): Promise<SessionUser | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts as [string, string, string];
    const expected = createHmac('sha256', this.secret).update(`${header}.${payload}`).digest();
    const provided = b64urlToBuf(signature);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
    try {
      const claims = JSON.parse(b64urlToBuf(payload).toString('utf8')) as { sub?: string; email?: string; exp?: number };
      if (!claims.sub) return null;
      if (claims.exp && Date.now() / 1000 >= claims.exp) return null;
      return { userId: claims.sub, email: claims.email };
    } catch {
      return null;
    }
  }
}

/** A verifier that always rejects — used when self-serve auth isn't configured. */
export class DisabledAuthVerifier implements AuthVerifier {
  async verify(): Promise<SessionUser | null> {
    return null;
  }
}

/** Build the verifier from env: Supabase HS256 when `SUPABASE_JWT_SECRET` is set, else disabled. */
export function authVerifierFromEnv(env: NodeJS.ProcessEnv = process.env): AuthVerifier {
  return env.SUPABASE_JWT_SECRET ? new SupabaseJwtVerifier(env.SUPABASE_JWT_SECRET) : new DisabledAuthVerifier();
}
