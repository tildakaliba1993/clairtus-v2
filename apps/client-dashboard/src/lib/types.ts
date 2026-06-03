/** Minimal view models for what the dashboard renders (mirrors the API responses). */
export interface Balance {
  accountId: string;
  type: string;
  ownerRef: string | null;
  currency: string;
  balance: number;
}
export interface Escrow {
  id: string;
  status: string;
  baseAmount: number;
  currency: string;
  feeResponsibility: string;
  sellerPartyId: string;
  createdAt: string;
}
export interface Payout {
  id: string;
  escrowId: string;
  amount: number;
  currency: string;
  status: string;
  rail: string | null;
  createdAt: string;
}
export interface WebhookDelivery {
  id: string;
  event_type: string;
  status: string;
  attempts: number;
  created_at: string;
}
