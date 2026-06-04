import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { JobQueue } from '@clairtus/queue';
import { AppModule } from '../src/app.module';
import { WebhookService } from '../src/webhooks/webhook.service';
import { EscrowService } from '../src/escrow/escrow.service';
import { SQL, JOB_QUEUE, type SqlExecutor } from '../src/db/sql';
import { PAYOUT_DISPATCH_QUEUE, type PayoutDispatchJob } from '../src/escrow/payout-dispatch';

/**
 * Background worker. Drains the two durable backlogs and exits (run on a schedule), or runs forever
 * with `--loop` (for a single always-on Fly machine). See docs/DEPLOYMENT.md §5.
 *   corepack pnpm --filter @clairtus/b2b-api webhook-worker          # one pass
 *   corepack pnpm --filter @clairtus/b2b-api webhook-worker --loop   # continuous
 */
const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 60_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function drainOnce(ctx: INestApplicationContext): Promise<{ webhooks: number; payouts: number }> {
  const sql = ctx.get<SqlExecutor>(SQL);
  const webhooks = ctx.get(WebhookService);
  const escrow = ctx.get(EscrowService);
  const queue = ctx.get<JobQueue>(JOB_QUEUE);

  // 1) Retry due webhook deliveries (already durable: backoff + dead-letter via max_attempts).
  const { rows } = await sql.query<{ tenant_id: string }>(
    `select distinct tenant_id from webhook_deliveries where status = 'pending' and next_retry_at <= now()`,
  );
  let webhookCount = 0;
  for (const r of rows) webhookCount += await webhooks.processDue(r.tenant_id);

  // 2) Dispatch queued payouts (rails were unavailable at request time) until the queue is idle.
  let payoutCount = 0;
  for (;;) {
    const outcome = await queue.process<PayoutDispatchJob>(PAYOUT_DISPATCH_QUEUE, (job) => escrow.dispatchQueuedPayout(job));
    if (outcome === 'idle') break;
    payoutCount += 1;
    if (outcome === 'rescheduled' || outcome === 'dead') break; // backoff/terminal — pick up next pass
  }
  return { webhooks: webhookCount, payouts: payoutCount };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const loop = process.argv.includes('--loop');
  const ctx = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    do {
      const { webhooks, payouts } = await drainOnce(ctx);
      console.log(`✓ worker: ${webhooks} webhook retr(ies), ${payouts} payout dispatch(es)`);
      if (loop) await sleep(INTERVAL_MS);
    } while (loop);
  } finally {
    await ctx.close();
  }
}

main().catch((err) => { console.error('✗ worker failed:', err); process.exit(1); });
