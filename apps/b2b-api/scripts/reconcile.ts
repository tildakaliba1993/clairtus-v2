import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ReconciliationService } from '../src/recon/reconciliation.service';
import { RAIL } from '../src/db/sql';

/**
 * Reconciles the ledger against the PSP (Korapay) balance per currency and prints any drift. Run on a
 * schedule; exits non-zero on drift so a cron/alerting wrapper can page.
 *   corepack pnpm --filter @clairtus/b2b-api reconcile
 */
interface BalanceRail { getBalances?: () => Promise<Record<string, { available: number; pending: number }>> }

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(1); }
  const ctx = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const recon = ctx.get(ReconciliationService);
    const rail = ctx.get<BalanceRail | null>(RAIL, { strict: false });

    const railBalances: Record<string, number> = {};
    if (rail && typeof rail.getBalances === 'function') {
      for (const [ccy, bal] of Object.entries(await rail.getBalances())) railBalances[ccy] = bal.available;
    } else {
      console.warn('No balance-capable rail configured — comparing the ledger against an empty PSP balance.');
    }

    const tolerance = Number(process.env.RECON_TOLERANCE_MINOR ?? 0);
    const rows = await recon.reconcile(railBalances, tolerance);
    let drift = false;
    for (const r of rows) {
      console.log(`${r.currency}: ledger=${r.ledgerMinor} rail=${r.railMinor} drift=${r.driftMinor} ${r.ok ? 'OK' : 'DRIFT!'}`);
      drift = drift || !r.ok;
    }
    process.exitCode = drift ? 2 : 0;
  } finally {
    await ctx.close();
  }
}

main().catch((err) => { console.error('✗ reconcile failed:', err); process.exit(1); });
