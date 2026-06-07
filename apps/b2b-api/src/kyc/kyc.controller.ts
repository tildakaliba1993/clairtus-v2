import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '@clairtus/tenancy';
import { CurrentTenant } from '../common/tenant.decorator';
import { Public } from '../common/public.decorator';
import { Scopes, SCOPES } from '../common/scopes';
import { KycService } from './kyc.service';
import { CreateKycCheckDto } from './kyc.dto';

@ApiTags('kyc')
@ApiBearerAuth('api-key')
@Controller('kyc')
export class KycController {
  constructor(private readonly svc: KycService) {}

  @Post('checks')
  @Scopes(SCOPES.kycWrite)
  create(@CurrentTenant() t: AuthContext, @Body() body: CreateKycCheckDto) {
    return this.svc.createCheck(t.tenantId, body);
  }

  @Get('checks/:id')
  get(@CurrentTenant() t: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
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
