import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { PaymentRail } from '@clairtus/payments';
import { Public } from '../common/public.decorator';
import { RAIL } from '../db/sql';
import { EscrowService } from '../escrow/escrow.service';

/**
 * Inbound rail webhooks (M7). Public — authenticated by the **provider signature**, not an API key.
 * Verifies the HMAC, normalizes the event, and drives the escrow/payout lifecycle. Idempotent on
 * re-delivery. Unknown/irrelevant events are acknowledged (200) so the provider doesn't retry-storm.
 */
@ApiTags('webhooks')
@Controller('webhooks')
export class RailWebhookController {
  constructor(
    @Inject(RAIL) private readonly rail: PaymentRail | null,
    private readonly escrow: EscrowService,
  ) {}

  @Public()
  @Post('korapay')
  @HttpCode(200)
  async korapay(@Body() body: unknown, @Headers() headers: Record<string, string>) {
    if (!this.rail) throw new ServiceUnavailableException('live rail not configured');
    if (!this.rail.verifyWebhook(body, headers)) throw new UnauthorizedException('invalid webhook signature');
    const event = this.rail.parseWebhook(body, headers);
    if (!event) return { ok: true, ignored: true };
    const res = await this.escrow.handleRailEvent(event);
    return { ok: true, handled: res.handled };
  }
}
