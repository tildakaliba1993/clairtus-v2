import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { JobQueue, type SqlExecutor } from '../src';

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

let db: PGlite;
let clock: number;
let q: JobQueue;

beforeEach(async () => {
  db = new PGlite();
  clock = 0;
  q = new JobQueue(executor(db), () => clock);
  await q.init();
});

describe('JobQueue', () => {
  it('enqueues and claims the next due job (attempts increments)', async () => {
    await q.enqueue('payouts', { payoutId: 'p1' });
    const job = await q.claim<{ payoutId: string }>('payouts');
    expect(job).not.toBeNull();
    expect(job!.payload.payoutId).toBe('p1');
    expect(job!.status).toBe('processing');
    expect(job!.attempts).toBe(1);
    expect(await q.claim('payouts')).toBeNull(); // nothing left pending
  });

  it('does not claim a job whose run_after is in the future', async () => {
    await q.enqueue('webhooks', { x: 1 }, { delaySeconds: 60 });
    expect(await q.claim('webhooks')).toBeNull();
    clock = 60_000;
    expect(await q.claim('webhooks')).not.toBeNull();
  });

  it('process() completes a job on success', async () => {
    await q.enqueue('payins', { id: 'a' });
    const outcome = await q.process('payins', async () => { /* ok */ });
    expect(outcome).toBe('done');
    expect((await q.stats('payins')).done).toBe(1);
  });

  it('retries with backoff then dead-letters after max attempts (DLQ)', async () => {
    await q.enqueue('payouts', { id: 'flaky' }, { maxAttempts: 3 });
    const failing = async () => { throw new Error('rail down'); };

    // Attempt 1 → rescheduled.
    expect(await q.process('payouts', failing)).toBe('rescheduled');
    expect((await q.stats('payouts')).pending).toBe(1);

    // Advance past backoff; attempt 2 → rescheduled.
    clock = 10_000;
    expect(await q.process('payouts', failing)).toBe('rescheduled');

    // Advance again; attempt 3 hits the cap → dead-lettered.
    clock = 60_000;
    expect(await q.process('payouts', failing)).toBe('dead');

    const stats = await q.stats('payouts');
    expect(stats.dead).toBe(1);
    expect(stats.pending).toBe(0);

    // A dead job is terminal — not claimable.
    clock = 10_000_000;
    expect(await q.claim('payouts')).toBeNull();
  });

  it('process() on an empty queue is idle', async () => {
    expect(await q.process('nothing', async () => {})).toBe('idle');
  });
});
