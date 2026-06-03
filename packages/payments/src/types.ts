/** Payment-rail domain types. Amounts are integer MINOR units; country is ISO-2. */

export type PaymentMethod = 'mobile_money' | 'bank_transfer' | 'card';
export type Direction = 'payIn' | 'payOut';
export type RailStatusValue = 'pending' | 'succeeded' | 'failed';

export interface RailCapabilities {
  payIn: boolean;
  payOut: boolean;
  /** Can collected funds REST in our balance for conditional release (escrow)? */
  hold: boolean;
  countries: readonly string[]; // ISO-2, e.g. ['CD'], ['ZA']
  currencies: readonly string[];
  methods: readonly PaymentMethod[];
}

export interface PayInRequest {
  reference: string; // idempotency key
  amount: number;
  currency: string;
  country: string;
  method: PaymentMethod;
  payer: { phone?: string; accountRef?: string; name?: string };
  metadata?: Record<string, unknown>;
}

export interface PayInResult {
  railRef: string;
  status: RailStatusValue;
  instructions?: { type: 'redirect' | 'prompt' | 'virtual_account'; value?: string };
}

export interface PayoutRequest {
  reference: string;
  amount: number;
  currency: string;
  country: string;
  method: PaymentMethod;
  recipient: { phone?: string; accountRef?: string; bankCode?: string; name?: string };
  metadata?: Record<string, unknown>;
}

export interface PayoutResult {
  railRef: string;
  status: RailStatusValue;
}

export interface RailStatus {
  railRef: string;
  status: RailStatusValue;
}

export type NormalizedEventType =
  | 'payin.succeeded'
  | 'payin.failed'
  | 'payout.succeeded'
  | 'payout.failed';

/** A provider webhook normalized into one shape the core understands. */
export interface NormalizedEvent {
  type: NormalizedEventType;
  railRef: string;
  reference?: string;
  raw?: unknown;
}
