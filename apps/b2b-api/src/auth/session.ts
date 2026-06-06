import { createHmac, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

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

function claimsToUser(payload: { sub?: unknown; email?: unknown }): SessionUser | null {
  if (typeof payload.sub !== 'string' || !payload.sub) return null;
  return { userId: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
}

/**
 * Verifies an **asymmetric** (ES256 / RS256) JWT against a JWKS — Supabase's modern signing keys. The
 * key resolver typically points at the project's `…/auth/v1/.well-known/jwks.json` (rotating keys are
 * cached + refetched). jose checks the signature + `exp`.
 */
export class JwksAuthVerifier implements AuthVerifier {
  constructor(private readonly keys: JWTVerifyGetKey) {}

  async verify(token: string): Promise<SessionUser | null> {
    try {
      const { payload } = await jwtVerify(token, this.keys);
      return claimsToUser(payload);
    } catch {
      return null;
    }
  }
}

/** Build a JWKS verifier for a Supabase project URL (derives the well-known JWKS endpoint). */
export function supabaseJwksVerifier(supabaseUrl: string): JwksAuthVerifier {
  const jwksUrl = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
  return new JwksAuthVerifier(createRemoteJWKSet(new URL(jwksUrl)));
}

/**
 * Verifies a Supabase **HS256** JWT with the legacy project JWT secret (`SUPABASE_JWT_SECRET`): checks
 * the signature + expiry. (Used when the project still signs with the shared secret rather than keys.)
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

/**
 * Build the verifier from env, preferring Supabase's modern **asymmetric** keys:
 *  1. `SUPABASE_JWKS_URL` or `SUPABASE_URL` → JWKS (ES256/RS256) — the current Supabase default.
 *  2. `SUPABASE_JWT_SECRET` → legacy HS256 shared secret.
 *  3. otherwise → disabled (self-serve off).
 */
export function authVerifierFromEnv(env: NodeJS.ProcessEnv = process.env): AuthVerifier {
  if (env.SUPABASE_JWKS_URL) return new JwksAuthVerifier(createRemoteJWKSet(new URL(env.SUPABASE_JWKS_URL)));
  if (env.SUPABASE_URL) return supabaseJwksVerifier(env.SUPABASE_URL);
  if (env.SUPABASE_JWT_SECRET) return new SupabaseJwtVerifier(env.SUPABASE_JWT_SECRET);
  return new DisabledAuthVerifier();
}
