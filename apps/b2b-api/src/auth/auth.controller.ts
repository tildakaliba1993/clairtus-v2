import { Controller, Get, HttpCode, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/public.decorator';
import { SessionAuthGuard, SessionUserParam } from './session.guard';
import type { SessionUser } from './session';
import { SignupService } from './signup.service';

/**
 * Self-serve auth (Phase 3). These routes authenticate by the **session token** (Supabase JWT) — not an
 * API key — so they're @Public to the API-key guard and protected by the SessionAuthGuard instead.
 * `signup` provisions a tenant + keys on first login; `me` bootstraps the dashboard (tenant + key list).
 */
@ApiTags('auth')
@Public()
@UseGuards(SessionAuthGuard)
@Controller('auth')
export class AuthController {
  constructor(private readonly signup: SignupService) {}

  @Post('signup')
  @HttpCode(200)
  provision(@SessionUserParam() user: SessionUser) {
    return this.signup.provision(user);
  }

  @Get('me')
  async me(@SessionUserParam() user: SessionUser) {
    const result = await this.signup.getByUser(user.userId);
    if (!result) throw new NotFoundException('no tenant provisioned for this user');
    return result;
  }
}
