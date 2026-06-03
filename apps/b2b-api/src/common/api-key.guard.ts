import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Tenancy } from '@clairtus/tenancy';
import { IS_PUBLIC } from './public.decorator';

/**
 * Authenticates every request by its `Authorization: Bearer ck_…` API key, resolving it
 * to a tenant context via Tenancy.authenticate (which rejects unknown & revoked keys).
 * Routes marked @Public() are exempt.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenancy: Tenancy,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) throw new UnauthorizedException('Missing API key');

    const auth = await this.tenancy.authenticate(match[1]!.trim());
    if (!auth) throw new UnauthorizedException('Invalid or revoked API key');

    req.tenant = auth;
    return true;
  }
}
