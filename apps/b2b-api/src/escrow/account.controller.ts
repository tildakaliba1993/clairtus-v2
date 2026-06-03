import { Controller, Get } from '@nestjs/common';
import type { AuthContext } from '@clairtus/tenancy';
import { CurrentTenant } from '../common/tenant.decorator';
import { EscrowService } from './escrow.service';

/** Read-only money views for the tenant: account balances and the raw ledger feed. */
@Controller()
export class AccountController {
  constructor(private readonly svc: EscrowService) {}

  @Get('balances')
  balances(@CurrentTenant() t: AuthContext) {
    return this.svc.listBalances(t.tenantId);
  }

  @Get('ledger')
  ledger(@CurrentTenant() t: AuthContext) {
    return this.svc.listLedger(t.tenantId);
  }
}
