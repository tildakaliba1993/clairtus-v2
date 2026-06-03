import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { AuthContext } from '@clairtus/tenancy';
import { CurrentTenant } from '../common/tenant.decorator';
import { EscrowService, type CreatePayoutDto } from './escrow.service';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly svc: EscrowService) {}

  @Post()
  create(@CurrentTenant() t: AuthContext, @Body() body: CreatePayoutDto) {
    return this.svc.createPayout(t.tenantId, body, t.mode);
  }

  @Get()
  list(@CurrentTenant() t: AuthContext) {
    return this.svc.listPayouts(t.tenantId);
  }

  @Get(':id')
  get(@CurrentTenant() t: AuthContext, @Param('id') id: string) {
    return this.svc.getPayout(t.tenantId, id);
  }
}
