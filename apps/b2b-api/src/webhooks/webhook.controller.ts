import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { AuthContext } from '@clairtus/tenancy';
import { CurrentTenant } from '../common/tenant.decorator';
import { WebhookService } from './webhook.service';

@Controller()
export class WebhookController {
  constructor(private readonly svc: WebhookService) {}

  @Post('webhook-endpoints')
  register(@CurrentTenant() t: AuthContext, @Body() body: { url?: string }) {
    if (!body?.url) throw new BadRequestException('url is required');
    return this.svc.registerEndpoint(t.tenantId, body.url);
  }

  @Get('webhook-deliveries')
  list(@CurrentTenant() t: AuthContext) {
    return this.svc.listDeliveries(t.tenantId);
  }

  @Post('webhook-deliveries/:id/replay')
  @HttpCode(200)
  async replay(@CurrentTenant() t: AuthContext, @Param('id') id: string) {
    await this.svc.replay(t.tenantId, id);
    return { ok: true };
  }
}
