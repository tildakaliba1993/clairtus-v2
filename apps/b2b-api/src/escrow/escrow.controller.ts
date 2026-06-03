import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { AuthContext } from '@clairtus/tenancy';
import { CurrentTenant } from '../common/tenant.decorator';
import { EscrowService, type CreateEscrowDto } from './escrow.service';

@Controller('escrows')
export class EscrowController {
  constructor(private readonly svc: EscrowService) {}

  @Post()
  create(@CurrentTenant() t: AuthContext, @Body() body: CreateEscrowDto) {
    return this.svc.createEscrow(t.tenantId, body);
  }

  @Get(':id')
  get(@CurrentTenant() t: AuthContext, @Param('id') id: string) {
    return this.svc.getEscrow(t.tenantId, id);
  }

  @Post(':id/fund')
  @HttpCode(200)
  fund(@CurrentTenant() t: AuthContext, @Param('id') id: string) {
    return this.svc.fund(t.tenantId, id);
  }

  @Post(':id/release')
  @HttpCode(200)
  release(@CurrentTenant() t: AuthContext, @Param('id') id: string) {
    return this.svc.release(t.tenantId, id);
  }

  @Post(':id/refund')
  @HttpCode(200)
  refund(@CurrentTenant() t: AuthContext, @Param('id') id: string) {
    return this.svc.refund(t.tenantId, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentTenant() t: AuthContext, @Param('id') id: string) {
    return this.svc.cancel(t.tenantId, id);
  }

  @Post(':id/dispute')
  @HttpCode(200)
  dispute(@CurrentTenant() t: AuthContext, @Param('id') id: string) {
    return this.svc.dispute(t.tenantId, id);
  }
}
