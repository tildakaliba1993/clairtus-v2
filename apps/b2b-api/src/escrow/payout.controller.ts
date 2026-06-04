import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '@clairtus/tenancy';
import { CurrentTenant } from '../common/tenant.decorator';
import { Scopes, SCOPES } from '../common/scopes';
import { RequireIdempotencyKey } from '../common/idempotency.decorator';
import { EscrowService } from './escrow.service';
import { CreatePayoutDto } from './escrow.dto';

@ApiTags('payouts')
@ApiBearerAuth('api-key')
@Controller('payouts')
export class PayoutController {
  constructor(private readonly svc: EscrowService) {}

  @Post()
  @Scopes(SCOPES.payoutsWrite)
  @RequireIdempotencyKey()
  create(@CurrentTenant() t: AuthContext, @Body() body: CreatePayoutDto) {
    return this.svc.createPayout(t.tenantId, body, t.mode);
  }

  @Get()
  list(@CurrentTenant() t: AuthContext, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.svc.listPayouts(t.tenantId, { limit: limit ? Number(limit) : undefined, cursor });
  }

  @Get(':id')
  get(@CurrentTenant() t: AuthContext, @Param('id') id: string) {
    return this.svc.getPayout(t.tenantId, id);
  }
}
