import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Tenancy, type AuthContext } from '@clairtus/tenancy';
import { IS_PUBLIC } from './public.decorator';
import { SCOPES_KEY, DEFAULT_WRITE_SCOPES, type Scope } from './scopes';
import { AUTH_VERIFIER, type AuthVerifier } from '../auth/session';
import { SignupService } from '../auth/signup.service';

/**
 * Authenticates every (non-@Public) request by its `Authorization: Bearer …` credential, accepting
 * EITHER:
 *  - an **API key** (`ck_…`) → resolved to its tenant + scopes + mode via Tenancy.authenticate, or
 *  - a **session token** (Supabase JWT) → verified, then resolved to the owner's tenant via
 *    `tenant_users`. A session is the tenant owner, so it gets the full owner scopes — but always in
 *    **test mode**: a browser session must never move live money (that stays server-to-server with a
 *    live API key).
 * Then authorizes against the route's `@Scopes(...)` requirement (403 when a scope is missing).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenancy: Tenancy,
    @Inject(AUTH_VERIFIER) private readonly verifier: AuthVerifier,
    private readonly signup: SignupService,
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
    if (!match) throw new UnauthorizedException('Missing API key or session token');
    const token = match[1]!.trim();

    req.tenant = await this.resolveAuth(token, req);

    // Authorize: the route may require one or more scopes; the credential must carry all of them.
    const required = this.reflector.getAllAndOverride<Scope[]>(SCOPES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required && required.length > 0) {
      const held = new Set(req.tenant.scopes);
      const missing = required.filter((s) => !held.has(s));
      if (missing.length > 0) {
        throw new ForbiddenException(`missing required scope(s): ${missing.join(', ')}`);
      }
    }

    return true;
  }

  /** Resolve a bearer token to a tenant context: API key first, then a session JWT. */
  private async resolveAuth(token: string, req: { sessionUser?: unknown }): Promise<AuthContext> {
    // 1. API key (the common server-to-server path).
    const keyAuth = await this.tenancy.authenticate(token);
    if (keyAuth) return keyAuth;

    // 2. Session token (a logged-in dashboard user). Verify, then map to their tenant.
    const user = await this.verifier.verify(token);
    if (!user) throw new UnauthorizedException('Invalid or revoked API key / session token');

    const tenantId = await this.signup.tenantIdForUser(user.userId);
    if (!tenantId) throw new UnauthorizedException('No tenant provisioned for this session — sign up first');

    req.sessionUser = user;
    return { tenantId, mode: 'test', scopes: [...DEFAULT_WRITE_SCOPES] };
  }
}
