import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Tenancy } from '@clairtus/tenancy';
import { IS_PUBLIC } from './public.decorator';
import { SCOPES_KEY, type Scope } from './scopes';

/**
 * Authenticates every request by its `Authorization: Bearer ck_…` API key, resolving it
 * to a tenant context via Tenancy.authenticate (which rejects unknown & revoked keys), then
 * authorizes it against the route's `@Scopes(...)` requirement (403 when the key lacks a scope).
 * Routes marked @Public() are exempt from both.
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

    // Authorize: the route may require one or more scopes; the key must carry all of them.
    const required = this.reflector.getAllAndOverride<Scope[]>(SCOPES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required && required.length > 0) {
      const held = new Set(auth.scopes);
      const missing = required.filter((s) => !held.has(s));
      if (missing.length > 0) {
        throw new ForbiddenException(`API key missing required scope(s): ${missing.join(', ')}`);
      }
    }

    return true;
  }
}
