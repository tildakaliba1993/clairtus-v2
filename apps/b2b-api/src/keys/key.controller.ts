import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Tenancy, type AuthContext } from '@clairtus/tenancy';
import { CurrentTenant } from '../common/tenant.decorator';
import { Scopes, SCOPES } from '../common/scopes';
import { AuditService } from '../audit/audit.service';
import { CreateApiKeyDto } from './key.dto';

/**
 * Tenant-facing API-key management (Phase 3). A key with `keys:write` can mint/revoke keys for **its own
 * tenant**; `keys:read` can list them. The plaintext secret is returned ONCE at creation. This is the
 * backend the dashboard key-management UI (and later self-serve signup) drives.
 */
@ApiTags('keys')
@ApiBearerAuth('api-key')
@Controller('keys')
export class KeyController {
  constructor(
    private readonly tenancy: Tenancy,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Scopes(SCOPES.keysRead)
  list(@CurrentTenant() t: AuthContext) {
    return this.tenancy.listApiKeys(t.tenantId);
  }

  @Post()
  @Scopes(SCOPES.keysWrite)
  async create(@CurrentTenant() t: AuthContext, @Body() body: CreateApiKeyDto) {
    const key = await this.tenancy.issueApiKey({ tenantId: t.tenantId, mode: body.mode, scopes: body.scopes ?? [] });
    await this.audit.record({
      tenantId: t.tenantId, action: 'apikey.issued', resourceType: 'apikey', resourceId: key.id,
      metadata: { mode: body.mode, last4: key.last4, scopes: body.scopes ?? [] },
    });
    // The plaintext is shown ONCE — the caller must store it now.
    return { id: key.id, mode: key.mode, last4: key.last4, scopes: body.scopes ?? [], plaintext: key.plaintext };
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @Scopes(SCOPES.keysWrite)
  async revoke(@CurrentTenant() t: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const revoked = await this.tenancy.revokeApiKey(id, t.tenantId);
    if (!revoked) throw new NotFoundException('key not found'); // wrong tenant / already revoked / unknown
    await this.audit.record({ tenantId: t.tenantId, action: 'apikey.revoked', resourceType: 'apikey', resourceId: id });
    return { id, revoked: true };
  }
}
