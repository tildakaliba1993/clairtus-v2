import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { type Observable, of, firstValueFrom } from 'rxjs';
import { SQL, type SqlExecutor } from '../db/sql';
import { REQUIRE_IDEMPOTENCY_KEY } from './idempotency.decorator';

/** status_code sentinel for a claimed-but-not-yet-completed key (no real HTTP status is 0). */
const PENDING = 0;
/** How long a concurrent caller waits for the in-flight winner before giving up with 409. */
const WAIT_TIMEOUT_MS = 10_000;
const WAIT_POLL_MS = 50;

/**
 * Enforces invariant #3 — money ops are idempotent AND concurrency-safe. For any mutating request
 * carrying an `Idempotency-Key`, the key is **claimed before the handler runs** (an atomic
 * insert-on-conflict), so two concurrent same-key requests can never both execute (no double
 * payout/fund). The winner runs the handler exactly once and persists its response; a concurrent
 * loser waits for it and replays the cached response. Reusing a key with a different request body is
 * a 409 conflict.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(SQL) private readonly sql: SqlExecutor,
    private readonly reflector: Reflector,
  ) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = ctx.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    const mutating = req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE';
    const key: string | undefined = req.headers['idempotency-key'];
    const tenantId: string | undefined = req.tenant?.tenantId;

    // Money-moving routes are marked @RequireIdempotencyKey() — reject them with 400 when the
    // header is absent, so a retried request can never double-move money by omitting the key.
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_IDEMPOTENCY_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required && !key) {
      throw new BadRequestException('Idempotency-Key header is required for this operation');
    }

    if (!mutating || !key || !tenantId) return next.handle();

    const requestHash = createHash('sha256')
      .update(`${req.method}:${req.originalUrl}:${JSON.stringify(req.body ?? {})}`)
      .digest('hex');

    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    for (;;) {
      // Claim the key BEFORE running the handler. The unique (tenant, key) means only one concurrent
      // request wins the insert; the response/status are filled in once the handler completes. The
      // claim row uses a `null` response + the PENDING status as a sentinel until then.
      const claim = await this.sql.query<{ key: string }>(
        `insert into idempotency_keys (tenant_id, key, request_hash, response, status_code)
         values ($1, $2, $3, 'null'::jsonb, $4)
         on conflict (tenant_id, key) do nothing
         returning key`,
        [tenantId, key, requestHash, PENDING],
      );

      if (claim.rows.length > 0) {
        // We own the key — run the handler exactly once, then persist its response.
        try {
          const body = await firstValueFrom(next.handle());
          const statusCode: number = res.statusCode ?? 200;
          await this.sql.query(
            `update idempotency_keys set response = $3::jsonb, status_code = $4 where tenant_id = $1 and key = $2`,
            [tenantId, key, JSON.stringify(body ?? null), statusCode],
          );
          return of(body);
        } catch (err) {
          // The op failed (no money moved) — release the claim so a legitimate retry can proceed.
          await this.sql.query(
            `delete from idempotency_keys where tenant_id = $1 and key = $2 and status_code = $3`,
            [tenantId, key, PENDING],
          );
          throw err;
        }
      }

      // Someone else holds the key. Inspect their row.
      const existing = await this.sql.query<{ response: unknown; status_code: number; request_hash: string }>(
        `select response, status_code, request_hash from idempotency_keys where tenant_id = $1 and key = $2`,
        [tenantId, key],
      );
      const row = existing.rows[0];
      if (!row) continue; // the winner released its claim (its handler failed) — retry the claim

      if (row.request_hash !== requestHash) {
        throw new ConflictException('Idempotency-Key was reused with a different request payload');
      }
      if (row.status_code !== PENDING) {
        res.status(row.status_code);
        return of(row.response); // completed — replay the cached response
      }
      // Still in flight — wait briefly for the winner, then replay its response.
      if (Date.now() >= deadline) {
        throw new ConflictException('a request with this Idempotency-Key is still being processed');
      }
      await new Promise((r) => setTimeout(r, WAIT_POLL_MS));
    }
  }
}
