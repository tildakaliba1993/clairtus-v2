/**
 * Onboard a tenant against the live database and print its API keys.
 *   DATABASE_URL=postgres://… pnpm --filter @clairtus/b2b-api onboard --name "Acme SA" --country ZA [--webhook https://…]
 */
import { Tenancy } from '@clairtus/tenancy';
import { connectPostgres } from '../src/db/postgres';
import { WebhookService } from '../src/webhooks/webhook.service';
import { onboardTenant } from '../src/onboarding/onboard';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const name = arg('--name');
if (!name) {
  console.error('usage: onboard --name "Acme SA" [--country ZA] [--webhook https://…]');
  process.exit(1);
}
const country = arg('--country') ?? 'ZA';
const webhookUrl = arg('--webhook');

const { executor, close } = connectPostgres(url);
const deps = { tenancy: new Tenancy(executor), webhooks: new WebhookService(executor, fetch) };

onboardTenant(deps, { name, country, webhookUrl })
  .then(async (r) => {
    console.log('\n✓ Tenant onboarded\n');
    console.log('  tenantId :', r.tenantId);
    console.log('  TEST key :', r.testKey, '  ← use this to log into the dashboard (sandbox)');
    console.log('  LIVE key :', r.liveKey);
    if (r.webhook) console.log('  webhook  :', r.webhook.id, '  signing secret:', r.webhook.signingSecret);
    console.log('\nSave these now — keys are shown only once.\n');
    await close();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('onboard failed:', e);
    await close().catch(() => {});
    process.exit(1);
  });
