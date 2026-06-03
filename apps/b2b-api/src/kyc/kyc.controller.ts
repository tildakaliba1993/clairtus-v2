import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import type { AuthContext } from '@clairtus/tenancy';
import { CurrentTenant } from '../common/tenant.decorator';
import { Public } from '../common/public.decorator';
import { KycService, type CreateKycCheckDto } from './kyc.service';

@Controller('kyc')
export class KycController {
  constructor(private readonly svc: KycService) {}

  @Post('checks')
  create(@CurrentTenant() t: AuthContext, @Body() body: CreateKycCheckDto) {
    return this.svc.createCheck(t.tenantId, body);
  }

  @Get('checks/:id')
  get(@CurrentTenant() t: AuthContext, @Param('id') id: string) {
    return this.svc.getCheck(t.tenantId, id);
  }

  // Provider → us. Authenticated by the provider signature, not an API key.
  @Public()
  @Post('callback')
  @HttpCode(200)
  callback(@Body() body: unknown, @Headers() headers: Record<string, string>) {
    return this.svc.handleCallback(body, headers);
  }
}
