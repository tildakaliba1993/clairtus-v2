import type { PaymentRail } from '../rail';
import type {
  RailCapabilities,
  PayInRequest,
  PayInResult,
  PayoutRequest,
  PayoutResult,
  RailStatus,
  RailStatusValue,
  NormalizedEvent,
} from '../types';

/**
 * PawaPay adapter — DRC mobile money. Ported from the live B2C pawapayClient,
 * but framework-agnostic: config + fetch are injected (Node, Deno, or a fake in
 * tests). Amounts arrive in integer MINOR units and are converted to PawaPay's
 * major-unit string format.
 */
export interface PawaPayConfig {
  baseUrl: string; // https://api.sandbox.pawapay.io | https://api.pawapay.io
  token: string;   // PAWAPAY_JWT
  returnUrl?: string;
  fetchImpl?: typeof fetch;
}

export function correspondentForPhone(phone: string): string {
  if (phone.startsWith('24397') || phone.startsWith('24399')) return 'AIRTEL_COD';
  if (phone.startsWith('24384') || phone.startsWith('24385') || phone.startsWith('24389')) return 'ORANGE_COD';
  return 'VODACOM_MPESA_COD';
}

/** PawaPay wants a major-unit string; CDF on Vodacom/M-Pesa must be a whole number. */
export function formatMajorAmount(correspondent: string, currency: string, major: number): string {
  if (correspondent === 'VODACOM_MPESA_COD' && currency.toUpperCase() === 'CDF') {
    return String(Math.round(major));
  }
  return major.toFixed(2);
}

function mapStatus(raw: string | undefined): RailStatusValue {
  const s = (raw ?? '').toUpperCase();
  if (s === 'COMPLETED') return 'succeeded';
  if (s === 'FAILED' || s === 'REJECTED') return 'failed';
  return 'pending'; // ACCEPTED, SUBMITTED, ENQUEUED…
}

export class PawaPayRail implements PaymentRail {
  readonly id = 'pawapay';
  readonly capabilities: RailCapabilities = {
    payIn: true,
    payOut: true,
    hold: false, // mobile money settles instantly; no balance-hold concept here
    countries: ['CD'],
    currencies: ['CDF', 'USD'],
    methods: ['mobile_money'],
  };

  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: PawaPayConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.token}` };
  }

  private async postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(`PawaPay error ${res.status}: ${JSON.stringify(json)}`);
    return json;
  }

  async initiatePayIn(req: PayInRequest): Promise<PayInResult> {
    const phone = req.payer.phone ?? '';
    const correspondent = correspondentForPhone(phone);
    const body = {
      depositId: req.reference,
      amount: formatMajorAmount(correspondent, req.currency, req.amount / 100),
      currency: req.currency.toUpperCase(),
      country: 'COD',
      correspondent,
      payer: { type: 'MSISDN', address: { value: phone } },
      customerTimestamp: new Date().toISOString(),
      statementDescription: 'Clairtus Escrow',
      ...(this.cfg.returnUrl ? { returnUrl: this.cfg.returnUrl } : {}),
    };
    const json = await this.postJson('/v1/deposits', body);
    return { railRef: req.reference, status: mapStatus(json.status as string), instructions: { type: 'prompt' } };
  }

  async initiatePayout(req: PayoutRequest): Promise<PayoutResult> {
    const phone = req.recipient.phone ?? '';
    const correspondent = correspondentForPhone(phone);
    const body = {
      payoutId: req.reference,
      amount: formatMajorAmount(correspondent, req.currency, req.amount / 100),
      currency: req.currency.toUpperCase(),
      country: 'COD',
      correspondent,
      recipient: { type: 'MSISDN', address: { value: phone } },
      customerTimestamp: new Date().toISOString(),
      statementDescription: 'Clairtus Payout',
      ...(this.cfg.returnUrl ? { returnUrl: this.cfg.returnUrl } : {}),
    };
    const json = await this.postJson('/v1/payouts', body);
    return { railRef: req.reference, status: mapStatus(json.status as string) };
  }

  async getStatus(railRef: string): Promise<RailStatus> {
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/v1/deposits/${railRef}`, { headers: this.headers() });
    const json = await res.json().catch(() => null);
    // PawaPay returns an array of one record for GET /v1/deposits/{id}.
    const record = Array.isArray(json) ? json[0] : json;
    return { railRef, status: mapStatus(record?.status) };
  }

  parseWebhook(body: unknown): NormalizedEvent | null {
    const b = body as { depositId?: string; payoutId?: string; status?: string } | null;
    if (!b) return null;
    if (b.depositId) {
      const s = mapStatus(b.status);
      if (s === 'pending') return null;
      return { type: s === 'succeeded' ? 'payin.succeeded' : 'payin.failed', railRef: b.depositId, reference: b.depositId, raw: b };
    }
    if (b.payoutId) {
      const s = mapStatus(b.status);
      if (s === 'pending') return null;
      return { type: s === 'succeeded' ? 'payout.succeeded' : 'payout.failed', railRef: b.payoutId, reference: b.payoutId, raw: b };
    }
    return null;
  }

  verifyWebhook(): boolean {
    // The live B2C PawaPay webhook trusts the callback (no signature check today).
    // Returning true preserves current behavior.
    // TODO(hardening): verify PawaPay's signature header once enabled.
    return true;
  }
}
