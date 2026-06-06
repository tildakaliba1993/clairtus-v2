import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { AUTH_VERIFIER, type AuthVerifier, type SessionUser } from './session';

/**
 * Authenticates a request by its session token (`Authorization: Bearer <jwt>`) via the AuthVerifier,
 * setting `req.sessionUser`. Used by the self-serve auth routes (which are exempt from the API-key
 * guard via @Public). 401 when the token is missing/invalid or self-serve auth is disabled.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(@Inject(AUTH_VERIFIER) private readonly verifier: AuthVerifier) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) throw new UnauthorizedException('Missing session token');
    const user = await this.verifier.verify(match[1]!.trim());
    if (!user) throw new UnauthorizedException('Invalid or expired session');
    req.sessionUser = user;
    return true;
  }
}

/** Injects the verified session user resolved by the SessionAuthGuard. */
export const SessionUserParam = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => ctx.switchToHttp().getRequest().sessionUser,
);
