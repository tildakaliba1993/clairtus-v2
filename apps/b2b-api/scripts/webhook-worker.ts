/**
 * Drains due webhook deliveries (retry with backoff). Run on a schedule — e.g. a Fly scheduled
 * machine or cron every minute:  pnpm --filter @clairtus/b2b-api webhook-worker
 */
import { connectPostgres } from '../src/db/postgres';
import { WebhookService } from '../src/webhooks/webhook.service';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const { executor, close } = connectPostgres(url);
const webhooks = new WebhookService(executor, fetch);

async function run(): Promise<void> {
  const { rows } = await executor.query<{ tenant_id: string }>(
    `select distinct tenant_id from webhook_deliveries where status = 'pending' and next_retry_at <= now()`,
  );
  let drained = 0;
  for (const r of rows) drained += await webhooks.processDue(r.tenant_id);
  console.log(`✓ webhook-worker: retried ${drained} delivery(ies) across ${rows.length} tenant(s)`);
}

run()
  .then(async () => { await close(); process.exit(0); })
  .catch(async (err) => { console.error('✗ webhook-worker failed:', err); await close().catch(() => {}); process.exit(1); });
