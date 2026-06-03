import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthContext } from '@clairtus/tenancy';

/** Injects the authenticated tenant context (set by ApiKeyGuard) into a handler param. */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext =>
    ctx.switchToHttp().getRequest().tenant,
);
