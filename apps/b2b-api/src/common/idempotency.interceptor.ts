import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { type Observable, of, mergeMap } from 'rxjs';
import { SQL, type SqlExecutor } from '../db/sql';

/**
 * Enforces invariant #3 — money ops are idempotent. For any mutating request carrying an
 * `Idempotency-Key`, the first call's response is cached per-tenant; replays return the
 * cached response WITHOUT re-running the handler. Reusing a key with a different request
 * body is a 409 conflict.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(SQL) private readonly sql: SqlExecutor) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = ctx.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    const mutating = req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE';
    const key: string | undefined = req.headers['idempotency-key'];
    const tenantId: string | undefined = req.tenant?.tenantId;
    if (!mutating || !key || !tenantId) return next.handle();

    const requestHash = createHash('sha256')
      .update(`${req.method}:${req.originalUrl}:${JSON.stringify(req.body ?? {})}`)
      .digest('hex');

    const existing = await this.sql.query<{ response: unknown; status_code: number; request_hash: string }>(
      `select response, status_code, request_hash from idempotency_keys where tenant_id = $1 and key = $2`,
      [tenantId, key],
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0]!;
      if (row.request_hash !== requestHash) {
        throw new ConflictException('Idempotency-Key was reused with a different request payload');
      }
      res.status(row.status_code);
      return of(row.response);
    }

    return next.handle().pipe(
      mergeMap(async (body) => {
        const statusCode: number = res.statusCode ?? 200;
        await this.sql.query(
          `insert into idempotency_keys (tenant_id, key, request_hash, response, status_code)
           values ($1, $2, $3, $4::jsonb, $5) on conflict (tenant_id, key) do nothing`,
          [tenantId, key, requestHash, JSON.stringify(body ?? null), statusCode],
        );
        return body;
      }),
    );
  }
}
