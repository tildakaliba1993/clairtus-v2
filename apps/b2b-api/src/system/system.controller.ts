import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { JobQueue } from '@clairtus/queue';
import type { AuthContext } from '@clairtus/tenancy';
import { CurrentTenant } from '../common/tenant.decorator';
import { Scopes, SCOPES } from '../common/scopes';
import { SQL, JOB_QUEUE, type SqlExecutor } from '../db/sql';
import { PAYOUT_DISPATCH_QUEUE } from '../escrow/payout-dispatch';

/**
 * Cross-cutting/system endpoints:
 * - GET /v1/whoami → echoes the authenticated tenant context (proves the API-key guard).
 * - POST /v1/echo  → idempotency demo (a replay under an Idempotency-Key returns the same id).
 * - GET /v1/system/metrics → system-wide operational counters (queue depth, DLQ, webhook backlog).
 *   These are NOT tenant data, so the route requires the operator-only `ops:read` scope (B11) — a
 *   standard tenant key gets 403; mint an ops key with `ops:read` for monitoring/alerting.
 */
@Controller()
export class SystemController {
  constructor(
    @Inject(SQL) private readonly sql: SqlExecutor,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  @Get('whoami')
  whoami(@CurrentTenant() tenant: AuthContext): AuthContext {
    return tenant;
  }

  @Post('echo')
  @HttpCode(200)
  echo(@Body() body: Record<string, unknown>): { id: string; echo: Record<string, unknown> } {
    return { id: randomUUID(), echo: body ?? {} };
  }

  @Get('system/metrics')
  @Scopes(SCOPES.opsRead)
  async metrics(): Promise<{
    queue: { payoutDispatch: Record<string, number> };
    webhooks: { due: number; stuck: number };
  }> {
    const payoutDispatch = await this.queue.stats(PAYOUT_DISPATCH_QUEUE);
    const due = await this.sql.query<{ n: number }>(
      `select count(*)::int as n from webhook_deliveries where status = 'pending' and next_retry_at <= now()`,
    );
    const stuck = await this.sql.query<{ n: number }>(
      `select count(*)::int as n from webhook_deliveries where status not in ('pending', 'delivered')`,
    );
    return {
      queue: { payoutDispatch },
      webhooks: { due: Number(due.rows[0]?.n ?? 0), stuck: Number(stuck.rows[0]?.n ?? 0) },
    };
  }
}
