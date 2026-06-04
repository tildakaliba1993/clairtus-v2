import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { AuthContext } from '@clairtus/tenancy';
import { CurrentTenant } from '../common/tenant.decorator';
import { Scopes, SCOPES } from '../common/scopes';
import { EscrowService } from './escrow.service';
import { CreatePartyDto } from './escrow.dto';

@Controller('parties')
export class PartyController {
  constructor(private readonly svc: EscrowService) {}

  @Post()
  @Scopes(SCOPES.partiesWrite)
  create(@CurrentTenant() t: AuthContext, @Body() body: CreatePartyDto) {
    return this.svc.createParty(t.tenantId, body);
  }

  @Get(':id')
  get(@CurrentTenant() t: AuthContext, @Param('id') id: string) {
    return this.svc.getParty(t.tenantId, id);
  }
}
