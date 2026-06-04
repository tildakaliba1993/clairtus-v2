import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '@clairtus/tenancy';
import { CurrentTenant } from '../common/tenant.decorator';
import { Scopes, SCOPES } from '../common/scopes';
import { RequireIdempotencyKey } from '../common/idempotency.decorator';
import { EscrowService } from './escrow.service';
import { CreateEscrowDto } from './escrow.dto';

@ApiTags('escrows')
@ApiBearerAuth('api-key')
@Controller('escrows')
export class EscrowController {
  constructor(private readonly svc: EscrowService) {}

  @Post()
  @Scopes(SCOPES.escrowsWrite)
  create(@CurrentTenant() t: AuthContext, @Body() body: CreateEscrowDto) {
    return this.svc.createEscrow(t.tenantId, body);
  }

  @Get()
  list(@CurrentTenant() t: AuthContext, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.svc.listEscrows(t.tenantId, { limit: limit ? Number(limit) : undefined, cursor });
  }

  @Get(':id')
  get(@CurrentTenant() t: AuthContext, @Param('id') id: string) {
    return this.svc.getEscrow(t.tenantId, id);
  }

  @Post(':id/fund')
  @HttpCode(200)
  @Scopes(SCOPES.escrowsWrite)
  @RequireIdempotencyKey()
  fund(@CurrentTenant() t: AuthContext, @Param('id') id: string) {
    return this.svc.fund(t.tenantId, id, t.mode);
  }

  @Post(':id/release')
  @HttpCode(200)
  @Scopes(SCOPES.escrowsWrite)
  @RequireIdempotencyKey()
  release(@CurrentTenant() t: AuthContext, @Param('id') id: string) {
    return this.svc.release(t.tenantId, id);
  }

  @Post(':id/refund')
  @HttpCode(200)
  @Scopes(SCOPES.escrowsWrite)
  @RequireIdempotencyKey()
  refund(@CurrentTenant() t: AuthContext, @Param('id') id: string) {
    return this.svc.refund(t.tenantId, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Scopes(SCOPES.escrowsWrite)
  cancel(@CurrentTenant() t: AuthContext, @Param('id') id: string) {
    return this.svc.cancel(t.tenantId, id);
  }

  @Post(':id/dispute')
  @HttpCode(200)
  @Scopes(SCOPES.escrowsWrite)
  dispute(@CurrentTenant() t: AuthContext, @Param('id') id: string) {
    return this.svc.dispute(t.tenantId, id);
  }
}
