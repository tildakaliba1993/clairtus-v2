import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { SupabaseJwtVerifier, DisabledAuthVerifier, authVerifierFromEnv } from './session';

function makeJwt(payload: Record<string, unknown>, secret: string): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc(payload);
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

const SECRET = 'super-secret-jwt';
const future = Math.floor(Date.now() / 1000) + 3600;

describe('SupabaseJwtVerifier', () => {
  it('verifies a valid HS256 token → { userId, email }', async () => {
    const v = new SupabaseJwtVerifier(SECRET);
    const token = makeJwt({ sub: 'user-1', email: 'a@b.com', exp: future }, SECRET);
    expect(await v.verify(token)).toEqual({ userId: 'user-1', email: 'a@b.com' });
  });

  it('rejects a token signed with the wrong secret', async () => {
    const v = new SupabaseJwtVerifier(SECRET);
    expect(await v.verify(makeJwt({ sub: 'u', exp: future }, 'wrong'))).toBeNull();
  });

  it('rejects an expired token', async () => {
    const v = new SupabaseJwtVerifier(SECRET);
    expect(await v.verify(makeJwt({ sub: 'u', exp: 1 }, SECRET))).toBeNull();
  });

  it('rejects a malformed token', async () => {
    const v = new SupabaseJwtVerifier(SECRET);
    expect(await v.verify('not.a.jwt')).toBeNull();
    expect(await v.verify('garbage')).toBeNull();
  });
});

describe('authVerifierFromEnv', () => {
  it('returns a disabled verifier (always null) when no secret is set', async () => {
    const v = authVerifierFromEnv({});
    expect(v).toBeInstanceOf(DisabledAuthVerifier);
    expect(await v.verify(makeJwt({ sub: 'u', exp: future }, SECRET))).toBeNull();
  });

  it('returns a working Supabase verifier when SUPABASE_JWT_SECRET is set', async () => {
    const v = authVerifierFromEnv({ SUPABASE_JWT_SECRET: SECRET } as NodeJS.ProcessEnv);
    expect(await v.verify(makeJwt({ sub: 'u9', exp: future }, SECRET))).toEqual({ userId: 'u9', email: undefined });
  });
});
