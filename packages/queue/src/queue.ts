/**
 * Durable, Postgres-backed job queue with retry + dead-letter (DLQ). Powers reliable
 * pay-in/payout/webhook processing: jobs are persisted, claimed by a worker, retried with
 * exponential backoff on failure, and moved to a `dead` terminal state after max attempts.
 * Database-agnostic via SqlExecutor (pglite in tests, Postgres in prod).
 */
export interface SqlExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

export const JOB_QUEUE_SCHEMA = `
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  queue text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts int not null default 0,
  max_attempts int not null default 5,
  run_after timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_due_idx on jobs(queue, status, run_after);
`;

export type JobStatus = 'pending' | 'processing' | 'done' | 'dead';
export interface Job<T = unknown> {
  id: string;
  queue: string;
  payload: T;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
}
export type ProcessOutcome = 'done' | 'dead' | 'rescheduled' | 'idle';

/** Exponential backoff (2s, 4s, 8s, …) capped at 1h. */
function backoffSeconds(attempts: number): number {
  return Math.min(3600, 2 ** attempts);
}

export class JobQueue {
  constructor(
    private readonly sql: SqlExecutor,
    private readonly now: () => number = Date.now,
  ) {}

  async init(): Promise<void> {
    for (const stmt of JOB_QUEUE_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
      await this.sql.query(stmt);
    }
  }

  async enqueue(
    queue: string,
    payload: unknown,
    opts: { maxAttempts?: number; delaySeconds?: number } = {},
  ): Promise<string> {
    const runAfter = new Date(this.now() + (opts.delaySeconds ?? 0) * 1000).toISOString();
    const { rows } = await this.sql.query<{ id: string }>(
      `insert into jobs (queue, payload, max_attempts, run_after)
       values ($1, $2::jsonb, $3, $4) returning id`,
      [queue, JSON.stringify(payload), opts.maxAttempts ?? 5, runAfter],
    );
    return rows[0]!.id;
  }

  /** Atomically claim the next due job (marks it processing, increments attempts). */
  async claim<T = unknown>(queue: string): Promise<Job<T> | null> {
    const nowIso = new Date(this.now()).toISOString();
    const { rows } = await this.sql.query<{
      id: string; queue: string; payload: T; status: JobStatus; attempts: number; max_attempts: number;
    }>(
      `update jobs set status='processing', attempts = attempts + 1, updated_at = now()
       where id = (
         select id from jobs
         where queue = $1 and status = 'pending' and run_after <= $2
         order by run_after asc, created_at asc
         limit 1
       )
       returning id, queue, payload, status, attempts, max_attempts`,
      [queue, nowIso],
    );
    if (rows.length === 0) return null;
    const r = rows[0]!;
    return { id: r.id, queue: r.queue, payload: r.payload, status: r.status, attempts: r.attempts, maxAttempts: r.max_attempts };
  }

  async complete(id: string): Promise<void> {
    await this.sql.query(`update jobs set status='done', updated_at=now() where id=$1`, [id]);
  }

  /** Fail a claimed job: reschedule with backoff, or dead-letter once attempts hit the cap. */
  async fail(job: Job, error: string): Promise<'rescheduled' | 'dead'> {
    if (job.attempts >= job.maxAttempts) {
      await this.sql.query(`update jobs set status='dead', last_error=$1, updated_at=now() where id=$2`, [error, job.id]);
      return 'dead';
    }
    const runAfter = new Date(this.now() + backoffSeconds(job.attempts) * 1000).toISOString();
    await this.sql.query(
      `update jobs set status='pending', run_after=$1, last_error=$2, updated_at=now() where id=$3`,
      [runAfter, error, job.id],
    );
    return 'rescheduled';
  }

  /** Claim + run one job through `handler`, recording the outcome. */
  async process<T = unknown>(queue: string, handler: (payload: T) => Promise<void>): Promise<ProcessOutcome> {
    const job = await this.claim<T>(queue);
    if (!job) return 'idle';
    try {
      await handler(job.payload);
      await this.complete(job.id);
      return 'done';
    } catch (err) {
      return this.fail(job, err instanceof Error ? err.message : String(err));
    }
  }

  async stats(queue: string): Promise<Record<JobStatus, number>> {
    const { rows } = await this.sql.query<{ status: JobStatus; count: string | number }>(
      `select status, count(*)::int as count from jobs where queue=$1 group by status`,
      [queue],
    );
    const out: Record<JobStatus, number> = { pending: 0, processing: 0, done: 0, dead: 0 };
    for (const r of rows) out[r.status] = Number(r.count);
    return out;
  }
}
