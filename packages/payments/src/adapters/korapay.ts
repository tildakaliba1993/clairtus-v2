import { createHmac, timingSafeEqual } from 'node:crypto';
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
 * Korapay adapter — South African / Nigerian pay-in + payout, framework-agnostic
 * (config + fetch injected, like the PawaPay adapter). Amounts arrive in integer
 * MINOR units and are converted to Korapay's major-unit number format.
 *
 * Escrow "hold" model (see ARCHITECTURE §6.1): Korapay has no native conditional-
 * release product. Collected funds settle into OUR Korapay Balance and rest there;
 * the ledger tracks per-escrow attribution; we call `initiatePayout` (disburse from
 * balance) only once the release condition is met. Custody stays with the licensed PSP.
 */
export interface KorapayConfig {
  baseUrl: string; // https://api.korapay.com
  secretKey: string; // KORAPAY_SECRET_KEY (sk_test_… / sk_live_…) — Bearer + webhook HMAC
  notificationUrl?: string; // where Korapay posts webhooks
  redirectUrl?: string; // where hosted checkout returns the customer
  fetchImpl?: typeof fetch;
}

/** Per-currency balance snapshot, in integer MINOR units. */
export interface RailBalance {
  available: number;
  pending: number;
}

/** Integer minor units → Korapay major-unit number (2dp), avoiding float drift. */
export function toMajorAmount(minor: number): number {
  return Number((minor / 100).toFixed(2));
}

/** Korapay major-unit number → integer minor units. */
function toMinorAmount(major: number): number {
  return Math.round(major * 100);
}

/** Map a Korapay charge/transfer status string to our normalized value. */
function mapStatus(raw: string | undefined): RailStatusValue {
  const s = (raw ?? '').toLowerCase();
  if (s === 'success' || s === 'successful') return 'succeeded';
  if (s === 'failed' || s === 'expired' || s === 'reversed') return 'failed';
  return 'pending'; // processing, pending, …
}

export class KorapayRail implements PaymentRail {
  readonly id = 'korapay';
  readonly capabilities: RailCapabilities = {
    payIn: true,
    payOut: true,
    hold: true, // collected funds rest in our Korapay Balance until we disburse
    countries: ['ZA', 'NG'],
    currencies: ['ZAR', 'NGN', 'USD'],
    methods: ['bank_transfer', 'card'],
  };

  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: KorapayConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.secretKey}` };
  }

  /** Korapay wraps every response as { status, message, data }. Unwrap `data` (or throw). */
  private async request(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || json.status === false) {
      throw new Error(`Korapay error ${res.status}: ${JSON.stringify(json)}`);
    }
    return (json.data ?? {}) as Record<string, unknown>;
  }

  async initiatePayIn(req: PayInRequest): Promise<PayInResult> {
    const customer = {
      name: req.payer.name ?? 'Customer',
      email: (req.metadata?.email as string | undefined) ?? '',
    };

    // Bank transfer = a temporary virtual account the customer pays into (no PCI scope).
    if (req.method === 'bank_transfer') {
      const data = await this.request('POST', '/merchant/api/v1/charges/bank-transfer', {
        reference: req.reference,
        amount: toMajorAmount(req.amount),
        currency: req.currency.toUpperCase(),
        ...(this.cfg.notificationUrl ? { notification_url: this.cfg.notificationUrl } : {}),
        customer,
      });
      const account = (data.bank_account ?? {}) as Record<string, unknown>;
      return {
        railRef: (data.reference as string) ?? req.reference,
        status: mapStatus(data.status as string),
        instructions: { type: 'virtual_account', value: account.account_number as string | undefined },
      };
    }

    // Card / EFT / PayShap go through hosted checkout (redirect) — keeps us out of PCI scope.
    const data = await this.request('POST', '/merchant/api/v1/charges/initialize', {
      reference: req.reference,
      amount: toMajorAmount(req.amount),
      currency: req.currency.toUpperCase(),
      ...(this.cfg.notificationUrl ? { notification_url: this.cfg.notificationUrl } : {}),
      ...(this.cfg.redirectUrl ? { redirect_url: this.cfg.redirectUrl } : {}),
      customer,
    });
    return {
      railRef: (data.reference as string) ?? req.reference,
      status: mapStatus(data.status as string),
      instructions: { type: 'redirect', value: data.checkout_url as string | undefined },
    };
  }

  async initiatePayout(req: PayoutRequest): Promise<PayoutResult> {
    const data = await this.request('POST', '/merchant/api/v1/transactions/disburse', {
      reference: req.reference,
      destination: {
        type: 'bank_account',
        amount: toMajorAmount(req.amount),
        currency: req.currency.toUpperCase(),
        narration: (req.metadata?.narration as string | undefined) ?? 'Clairtus Payout',
        bank_account: { bank: req.recipient.bankCode, account: req.recipient.accountRef },
        customer: {
          name: req.recipient.name ?? 'Recipient',
          email: (req.metadata?.email as string | undefined) ?? '',
        },
      },
    });
    return { railRef: (data.reference as string) ?? req.reference, status: mapStatus(data.status as string) };
  }

  async getStatus(railRef: string): Promise<RailStatus> {
    const data = await this.request('GET', `/merchant/api/v1/charges/${railRef}`);
    return { railRef, status: mapStatus(data.status as string) };
  }

  /** Verify a disbursement (payout) status — used by the custody spike + release flow. */
  async getPayoutStatus(railRef: string): Promise<RailStatus> {
    const data = await this.request('GET', `/merchant/api/v1/transactions/${railRef}`);
    return { railRef, status: mapStatus(data.status as string) };
  }

  /** Current Korapay Balance per currency, in integer minor units. */
  async getBalances(): Promise<Record<string, RailBalance>> {
    const data = await this.request('GET', '/merchant/api/v1/balances');
    const out: Record<string, RailBalance> = {};
    for (const [ccy, raw] of Object.entries(data)) {
      const b = raw as { available_balance?: number; pending_balance?: number };
      out[ccy] = {
        available: toMinorAmount(b.available_balance ?? 0),
        pending: toMinorAmount(b.pending_balance ?? 0),
      };
    }
    return out;
  }

  parseWebhook(body: unknown, _headers?: Record<string, string>): NormalizedEvent | null {
    const b = body as { event?: string; data?: { reference?: string } } | null;
    if (!b || !b.event || !b.data) return null;
    const ref = b.data.reference ?? '';
    switch (b.event) {
      case 'charge.success':
        return { type: 'payin.succeeded', railRef: ref, reference: ref, raw: b };
      case 'charge.failed':
        return { type: 'payin.failed', railRef: ref, reference: ref, raw: b };
      case 'transfer.success':
        return { type: 'payout.succeeded', railRef: ref, reference: ref, raw: b };
      case 'transfer.failed':
        return { type: 'payout.failed', railRef: ref, reference: ref, raw: b };
      default:
        return null; // charge.pending and other lifecycle events aren't release-relevant
    }
  }

  verifyWebhook(body: unknown, headers: Record<string, string>): boolean {
    // Korapay signs ONLY the `data` object: HMAC-SHA256(JSON.stringify(data)) with the secret key.
    const provided = headers['x-korapay-signature'] ?? headers['X-Korapay-Signature'];
    const data = (body as { data?: unknown } | null)?.data;
    if (!provided || data === undefined) return false;
    const expected = createHmac('sha256', this.cfg.secretKey).update(JSON.stringify(data)).digest('hex');
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
