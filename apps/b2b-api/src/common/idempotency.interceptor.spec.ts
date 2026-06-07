import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PGlite } from '@electric-sql/pglite';
import { defer, firstValueFrom, type Observable } from 'rxjs';
import { randomUUID } from 'node:crypto';
import type { SqlExecutor } from '../db/sql';
import { IDEMPOTENCY_SCHEMA } from '../db/sql';
import { IdempotencyInterceptor } from './idempotency.interceptor';

function executor(db: PGlite): SqlExecutor {
  return {
    async query(sql, params) {
      const r = await db.query(sql, params as never);
      return { rows: r.rows as never[] };
    },
    async transaction(fn) {
      return db.transaction(async (tx) =>
        fn({
          async query(sql, params) {
            const r = await tx.query(sql, params as never);
            return { rows: r.rows as never[] };
          },
          transaction() { throw new Error('nested'); },
        }),
      ) as never;
    },
  };
}

/** A minimal POST request/response + ExecutionContext for the interceptor. */
function makeCtx(tenantId: string, key: string, body: unknown): ExecutionContext {
  const res = { statusCode: 201, status(c: number) { this.statusCode = c; return this; } };
  const req = { method: 'POST', originalUrl: '/v1/escrows/e1/fund', headers: { 'idempotency-key': key }, body, tenant: { tenantId } };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => function handler() {},
    getClass: () => class Ctrl {},
  } as unknown as ExecutionContext;
}

let db: PGlite;
let sql: SqlExecutor;
let interceptor: IdempotencyInterceptor;
const TENANT = randomUUID();

beforeEach(async () => {
  db = new PGlite();
  sql = executor(db);
  for (const stmt of IDEMPOTENCY_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await sql.query(stmt);
  }
  interceptor = new IdempotencyInterceptor(sql, new Reflector());
});

const run = async (ctx: ExecutionContext, ch: CallHandler): Promise<unknown> =>
  firstValueFrom(await interceptor.intercept(ctx, ch));

describe('IdempotencyInterceptor — concurrency safety (A1)', () => {
  it('runs the handler exactly once for two concurrent same-key requests (claim before execute)', async () => {
    const key = randomUUID();
    const body = { amount: 100000 };
    let execCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    // The handler blocks until released, so both requests are in flight at the same time.
    const handler: CallHandler = { handle: (): Observable<unknown> => defer(async () => { execCount++; await gate; return { ok: true, n: execCount }; }) };

    const p = Promise.all([
      run(makeCtx(TENANT, key, body), handler),
      run(makeCtx(TENANT, key, body), handler),
    ]);
    // Give both requests time to reach the claim/handler, then let the winner finish.
    await new Promise((r) => setTimeout(r, 100));
    release();
    const [r1, r2] = await p;

    expect(execCount).toBe(1); // the money op ran ONCE despite two concurrent calls
    expect(r1).toEqual({ ok: true, n: 1 });
    expect(r2).toEqual({ ok: true, n: 1 }); // the loser replays the winner's cached response
    const rows = await sql.query<{ status_code: number }>(`select status_code from idempotency_keys where tenant_id = $1 and key = $2`, [TENANT, key]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.status_code).toBe(201); // settled, not the pending sentinel
  });

  it('replays the cached response on a sequential retry without re-running the handler', async () => {
    const key = randomUUID();
    const body = { amount: 5000 };
    let execCount = 0;
    const handler: CallHandler = { handle: (): Observable<unknown> => defer(async () => { execCount++; return { id: 'p1' }; }) };

    const first = await run(makeCtx(TENANT, key, body), handler);
    const second = await run(makeCtx(TENANT, key, body), handler);
    expect(execCount).toBe(1);
    expect(first).toEqual({ id: 'p1' });
    expect(second).toEqual({ id: 'p1' });
  });

  it('rejects reuse of a key with a different request body (409)', async () => {
    const key = randomUUID();
    const handler: CallHandler = { handle: (): Observable<unknown> => defer(async () => ({ ok: true })) };
    await run(makeCtx(TENANT, key, { amount: 1 }), handler);
    await expect(run(makeCtx(TENANT, key, { amount: 2 }), handler)).rejects.toBeInstanceOf(ConflictException);
  });

  it('releases the claim when the handler fails, so a legitimate retry can proceed', async () => {
    const key = randomUUID();
    const body = { amount: 7000 };
    let attempt = 0;
    const handler: CallHandler = { handle: (): Observable<unknown> => defer(async () => { attempt++; if (attempt === 1) throw new Error('boom'); return { ok: true, attempt }; }) };

    await expect(run(makeCtx(TENANT, key, body), handler)).rejects.toThrow('boom');
    // No poisoned row left behind.
    const after = await sql.query(`select 1 from idempotency_keys where tenant_id = $1 and key = $2`, [TENANT, key]);
    expect(after.rows).toHaveLength(0);
    // The retry succeeds and is cached.
    const retry = await run(makeCtx(TENANT, key, body), handler);
    expect(retry).toEqual({ ok: true, attempt: 2 });
  });
});
