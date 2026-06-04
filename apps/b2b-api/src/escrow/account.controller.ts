import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '@clairtus/tenancy';
import { CurrentTenant } from '../common/tenant.decorator';
import { EscrowService } from './escrow.service';

/** Read-only money views for the tenant: account balances and the raw ledger feed. */
@ApiTags('accounts')
@ApiBearerAuth('api-key')
@Controller()
export class AccountController {
  constructor(private readonly svc: EscrowService) {}

  @Get('balances')
  balances(@CurrentTenant() t: AuthContext) {
    return this.svc.listBalances(t.tenantId);
  }

  @Get('ledger')
  ledger(@CurrentTenant() t: AuthContext, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.svc.listLedger(t.tenantId, { limit: limit ? Number(limit) : undefined, cursor });
  }
}
