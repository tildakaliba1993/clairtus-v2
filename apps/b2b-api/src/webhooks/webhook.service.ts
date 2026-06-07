import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { SQL, FETCH, type SqlExecutor } from '../db/sql';
import { signWebhook, type WebhookEventType } from './signing';

/**
 * Validate a delivery URL: must be a well-formed absolute URL over **https** (B10). Webhook payloads
 * carry signed event data; plaintext http risks interception/tampering, so http (and other schemes)
 * are rejected. Throws BadRequestException → 400, whether called via the API or onboarding.
 */
function assertHttpsUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException('webhook url must be a valid absolute URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new BadRequestException('webhook url must use https');
  }
}

const MAX_ATTEMPTS = 5;
/** Exponential backoff with a 1h cap: 2^attempts seconds (2s, 4s, 8s, …). */
function backoffSeconds(attempts: number): number {
  return Math.min(3600, 2 ** attempts);
}

interface DeliveryJoin {
  id: string; endpoint_id: string; event_type: string; payload: unknown;
  attempts: number; max_attempts: number; url: string; signing_secret: string;
}

@Injectable()
export class WebhookService {
  constructor(
    @Inject(SQL) private readonly sql: SqlExecutor,
    @Inject(FETCH) private readonly fetchImpl: typeof fetch,
  ) {}

  /** Register a delivery endpoint (https only); returns the signing secret ONCE. */
  async registerEndpoint(tenantId: string, url: string): Promise<{ id: string; url: string; signingSecret: string }> {
    assertHttpsUrl(url);
    const signingSecret = `whsec_${randomBytes(24).toString('base64url')}`;
    const { rows } = await this.sql.query<{ id: string }>(
      `insert into webhook_endpoints (tenant_id, url, signing_secret) values ($1,$2,$3) returning id`,
      [tenantId, url, signingSecret],
    );
    return { id: rows[0]!.id, url, signingSecret };
  }

  /**
   * Records a domain event and fans it out to every active endpoint as a delivery, attempting
   * each immediately. Best-effort: a failing endpoint is logged + scheduled for retry, never
   * throwing back into the caller (an escrow transition must not fail because a webhook is down).
   */
  async emit(tenantId: string, evt: { type: WebhookEventType; escrowId?: string; data?: Record<string, unknown> }): Promise<void> {
    const ev = await this.sql.query<{ id: string; created_at: string }>(
      `insert into events (tenant_id, escrow_id, type, data) values ($1,$2,$3,$4::jsonb) returning id, created_at`,
      [tenantId, evt.escrowId ?? null, evt.type, JSON.stringify(evt.data ?? {})],
    );
    const eventId = ev.rows[0]!.id;
    const body = { id: eventId, type: evt.type, escrowId: evt.escrowId ?? null, data: evt.data ?? {}, createdAt: ev.rows[0]!.created_at };

    const endpoints = await this.sql.query<{ id: string }>(
      `select id from webhook_endpoints where tenant_id = $1 and active = true`,
      [tenantId],
    );
    for (const ep of endpoints.rows) {
      const del = await this.sql.query<{ id: string }>(
        `insert into webhook_deliveries (tenant_id, endpoint_id, event_id, event_type, payload, max_attempts)
         values ($1,$2,$3,$4,$5::jsonb,$6) returning id`,
        [tenantId, ep.id, eventId, evt.type, JSON.stringify(body), MAX_ATTEMPTS],
      );
      await this.attempt(tenantId, del.rows[0]!.id);
    }
  }

  /** Retry deliveries that are pending and due (called by a worker/cron). */
  async processDue(tenantId: string, now: number = Date.now()): Promise<number> {
    const due = await this.sql.query<{ id: string }>(
      `select id from webhook_deliveries
       where tenant_id = $1 and status = 'pending' and next_retry_at is not null and next_retry_at <= $2`,
      [tenantId, new Date(now).toISOString()],
    );
    for (const d of due.rows) await this.attempt(tenantId, d.id);
    return due.rows.length;
  }

  /** Force a re-attempt of a specific delivery (manual replay). */
  async replay(tenantId: string, deliveryId: string): Promise<void> {
    const exists = await this.sql.query(`select 1 from webhook_deliveries where id = $1 and tenant_id = $2`, [deliveryId, tenantId]);
    if (exists.rows.length === 0) throw new NotFoundException('delivery not found');
    await this.attempt(tenantId, deliveryId);
  }

  async listDeliveries(tenantId: string) {
    const { rows } = await this.sql.query<Record<string, unknown>>(
      `select id, endpoint_id, event_id, event_type, status, attempts, next_retry_at, last_error, created_at, delivered_at
       from webhook_deliveries where tenant_id = $1 order by created_at desc limit 100`,
      [tenantId],
    );
    return { data: rows };
  }

  /** One delivery attempt: POST the signed payload, then mark delivered / pending(retry) / failed. */
  private async attempt(tenantId: string, deliveryId: string): Promise<void> {
    const join = await this.sql.query<DeliveryJoin>(
      `select d.id, d.endpoint_id, d.event_type, d.payload, d.attempts, d.max_attempts, e.url, e.signing_secret
       from webhook_deliveries d join webhook_endpoints e on e.id = d.endpoint_id
       where d.id = $1 and d.tenant_id = $2`,
      [deliveryId, tenantId],
    );
    if (join.rows.length === 0) return;
    const d = join.rows[0]!;
    const attemptNo = d.attempts + 1;
    const bodyStr = JSON.stringify(d.payload);
    const ts = Math.floor(Date.now() / 1000);

    let ok = false;
    let error: string | null = null;
    try {
      const res = await this.fetchImpl(d.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Clairtus-Event': d.event_type,
          'X-Clairtus-Signature': signWebhook(d.signing_secret, bodyStr, ts),
        },
        body: bodyStr,
      });
      ok = res.ok;
      if (!ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    if (ok) {
      await this.sql.query(
        `update webhook_deliveries set status='delivered', attempts=$1, delivered_at=now(), next_retry_at=null, last_error=null where id=$2 and tenant_id=$3`,
        [attemptNo, deliveryId, tenantId],
      );
      return;
    }
    const exhausted = attemptNo >= d.max_attempts;
    const nextRetry = exhausted ? null : new Date(Date.now() + backoffSeconds(attemptNo) * 1000).toISOString();
    await this.sql.query(
      `update webhook_deliveries set status=$1, attempts=$2, next_retry_at=$3, last_error=$4 where id=$5 and tenant_id=$6`,
      [exhausted ? 'failed' : 'pending', attemptNo, nextRetry, error, deliveryId, tenantId],
    );
  }
}
