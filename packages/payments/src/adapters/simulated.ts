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
  NormalizedEventType,
} from '../types';

/**
 * Sandbox rail with deterministic, network-free outcomes — the engine behind test-mode.
 * The outcome is driven by `metadata.simulate` ('succeeded' | 'failed' | 'pending'),
 * defaulting to 'succeeded'. It implements the exact same `PaymentRail` interface as the
 * real adapters, so sandbox and production exercise identical code paths (parity).
 */
function decideOutcome(req: { metadata?: Record<string, unknown> }): RailStatusValue {
  const s = req.metadata?.simulate;
  if (s === 'failed' || s === 'pending' || s === 'succeeded') return s;
  return 'succeeded';
}

const WEBHOOK_TYPES = new Set<NormalizedEventType>([
  'payin.succeeded', 'payin.failed', 'payout.succeeded', 'payout.failed',
]);

export class SimulatedRail implements PaymentRail {
  readonly id = 'simulated';
  readonly capabilities: RailCapabilities = {
    payIn: true,
    payOut: true,
    hold: true,
    countries: ['ZA', 'NG', 'CD', 'KE', 'GH'],
    currencies: ['ZAR', 'NGN', 'USD', 'CDF', 'KES', 'GHS'],
    methods: ['bank_transfer', 'card', 'mobile_money'],
  };

  async initiatePayIn(req: PayInRequest): Promise<PayInResult> {
    return {
      railRef: `sim_pi_${req.reference}`,
      status: decideOutcome(req),
      instructions: { type: 'virtual_account', value: 'SIM-0000000000' },
    };
  }

  async initiatePayout(req: PayoutRequest): Promise<PayoutResult> {
    return { railRef: `sim_po_${req.reference}`, status: decideOutcome(req) };
  }

  async getStatus(railRef: string): Promise<RailStatus> {
    return { railRef, status: 'succeeded' };
  }

  parseWebhook(body: unknown): NormalizedEvent | null {
    const b = body as { event?: NormalizedEventType; reference?: string } | null;
    if (!b?.event || !b.reference || !WEBHOOK_TYPES.has(b.event)) return null;
    return { type: b.event, railRef: b.reference, reference: b.reference, raw: b };
  }

  verifyWebhook(): boolean {
    return true; // sandbox: no signature
  }
}
