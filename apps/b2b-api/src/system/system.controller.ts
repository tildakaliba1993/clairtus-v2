import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthContext } from '@clairtus/tenancy';
import { CurrentTenant } from '../common/tenant.decorator';

/**
 * Skeleton endpoints that exercise the cross-cutting concerns end-to-end:
 * - GET /v1/whoami → echoes the authenticated tenant context (proves the API-key guard).
 * - POST /v1/echo  → returns a freshly minted id; under an Idempotency-Key, a replay
 *   returns the SAME id (proves the response was cached, not re-executed).
 */
@Controller()
export class SystemController {
  @Get('whoami')
  whoami(@CurrentTenant() tenant: AuthContext): AuthContext {
    return tenant;
  }

  @Post('echo')
  @HttpCode(200)
  echo(@Body() body: Record<string, unknown>): { id: string; echo: Record<string, unknown> } {
    return { id: randomUUID(), echo: body ?? {} };
  }
}
