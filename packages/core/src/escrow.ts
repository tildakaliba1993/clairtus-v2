/**
 * The channel- and rail-agnostic escrow lifecycle.
 * Pure functions only: no WhatsApp, no payment provider, no DB. The app layer
 * executes the resulting domain events (webhooks) and ledger/rail operations.
 */

export type EscrowStatus =
  | 'DRAFT'
  | 'AWAITING_FUNDING'
  | 'FUNDED'
  | 'DISPUTED'
  | 'RELEASED'
  | 'REFUNDED'
  | 'CANCELLED';

export type EscrowEventType =
  | 'REQUEST_FUNDING'
  | 'FUNDING_CONFIRMED'
  | 'RELEASE'
  | 'REFUND'
  | 'CANCEL'
  | 'OPEN_DISPUTE'
  | 'RESOLVE_RELEASE'
  | 'RESOLVE_REFUND';

export interface EscrowState {
  readonly status: EscrowStatus;
}

export interface DomainEvent {
  readonly type: string;
}

export class EscrowTransitionError extends Error {}

/** The single source of truth for legal transitions. */
const TRANSITIONS: Record<EscrowStatus, Partial<Record<EscrowEventType, EscrowStatus>>> = {
  DRAFT: { REQUEST_FUNDING: 'AWAITING_FUNDING', CANCEL: 'CANCELLED' },
  AWAITING_FUNDING: { FUNDING_CONFIRMED: 'FUNDED', CANCEL: 'CANCELLED' },
  // Once funded, you cannot CANCEL — money has moved, so you must REFUND.
  FUNDED: { RELEASE: 'RELEASED', REFUND: 'REFUNDED', OPEN_DISPUTE: 'DISPUTED' },
  DISPUTED: { RESOLVE_RELEASE: 'RELEASED', RESOLVE_REFUND: 'REFUNDED' },
  RELEASED: {},
  REFUNDED: {},
  CANCELLED: {},
};

const EVENT_TO_DOMAIN: Record<EscrowEventType, string> = {
  REQUEST_FUNDING: 'escrow.awaiting_funding',
  FUNDING_CONFIRMED: 'escrow.funded',
  RELEASE: 'escrow.released',
  REFUND: 'escrow.refunded',
  CANCEL: 'escrow.cancelled',
  OPEN_DISPUTE: 'escrow.disputed',
  RESOLVE_RELEASE: 'escrow.released',
  RESOLVE_REFUND: 'escrow.refunded',
};

export function isTerminal(status: EscrowStatus): boolean {
  return status === 'RELEASED' || status === 'REFUNDED' || status === 'CANCELLED';
}

export function canApply(status: EscrowStatus, event: EscrowEventType): boolean {
  return TRANSITIONS[status][event] !== undefined;
}

/**
 * Applies an event to an escrow, returning the next state and the domain events
 * to emit. Throws EscrowTransitionError on an illegal transition.
 */
export function applyEscrowEvent(
  state: EscrowState,
  event: EscrowEventType,
): { state: EscrowState; events: DomainEvent[] } {
  const next = TRANSITIONS[state.status][event];
  if (next === undefined) {
    throw new EscrowTransitionError(
      `Illegal transition: cannot apply "${event}" from "${state.status}"`,
    );
  }
  return { state: { status: next }, events: [{ type: EVENT_TO_DOMAIN[event] }] };
}
