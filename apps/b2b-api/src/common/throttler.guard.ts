import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate-limits per **API key** (the bearer token) rather than per IP, so one tenant's traffic can't
 * exhaust another's budget and so a key behind shared NAT is still limited individually. Unauthenticated
 * requests fall back to the source IP. Limit/TTL come from THROTTLE_LIMIT / THROTTLE_TTL (see app.module).
 */
@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = (req.headers ?? {}) as Record<string, string | undefined>;
    return headers['authorization'] ?? (req.ip as string) ?? 'anonymous';
  }
}
