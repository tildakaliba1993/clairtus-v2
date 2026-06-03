import type {
  RailCapabilities,
  PayInRequest,
  PayInResult,
  PayoutRequest,
  PayoutResult,
  RailStatus,
  NormalizedEvent,
} from './types';

/**
 * The plug every payment provider implements. Product code never depends on a
 * specific provider — only on this interface — so rails are swapped by config.
 */
export interface PaymentRail {
  readonly id: string;
  readonly capabilities: RailCapabilities;

  initiatePayIn(req: PayInRequest): Promise<PayInResult>;
  initiatePayout(req: PayoutRequest): Promise<PayoutResult>;
  getStatus(railRef: string): Promise<RailStatus>;

  /** Normalize a provider webhook into a NormalizedEvent (or null if not relevant). */
  parseWebhook(body: unknown, headers: Record<string, string>): NormalizedEvent | null;
  /** Verify the provider's webhook signature. */
  verifyWebhook(body: unknown, headers: Record<string, string>): boolean;
}
