import { describe, it, expect } from 'vitest';
import {
  applyEscrowEvent,
  canApply,
  isTerminal,
  EscrowTransitionError,
  type EscrowState,
} from '../src/escrow';

const draft: EscrowState = { status: 'DRAFT' };

describe('escrow happy path', () => {
  it('DRAFT → AWAITING_FUNDING → FUNDED → RELEASED', () => {
    const a = applyEscrowEvent(draft, 'REQUEST_FUNDING');
    expect(a.state.status).toBe('AWAITING_FUNDING');
    expect(a.events).toEqual([{ type: 'escrow.awaiting_funding' }]);

    const b = applyEscrowEvent(a.state, 'FUNDING_CONFIRMED');
    expect(b.state.status).toBe('FUNDED');
    expect(b.events).toEqual([{ type: 'escrow.funded' }]);

    const c = applyEscrowEvent(b.state, 'RELEASE');
    expect(c.state.status).toBe('RELEASED');
    expect(c.events).toEqual([{ type: 'escrow.released' }]);
    expect(isTerminal(c.state.status)).toBe(true);
  });
});

describe('escrow dispute path', () => {
  it('FUNDED → DISPUTED → RELEASED', () => {
    const disputed = applyEscrowEvent({ status: 'FUNDED' }, 'OPEN_DISPUTE');
    expect(disputed.state.status).toBe('DISPUTED');
    const resolved = applyEscrowEvent(disputed.state, 'RESOLVE_RELEASE');
    expect(resolved.state.status).toBe('RELEASED');
  });
  it('FUNDED → DISPUTED → REFUNDED', () => {
    const disputed = applyEscrowEvent({ status: 'FUNDED' }, 'OPEN_DISPUTE');
    const refunded = applyEscrowEvent(disputed.state, 'RESOLVE_REFUND');
    expect(refunded.state.status).toBe('REFUNDED');
  });
});

describe('escrow guards (illegal transitions throw)', () => {
  it('cannot RELEASE from DRAFT', () => {
    expect(() => applyEscrowEvent(draft, 'RELEASE')).toThrow(EscrowTransitionError);
  });
  it('cannot re-fund a FUNDED escrow', () => {
    expect(() => applyEscrowEvent({ status: 'FUNDED' }, 'FUNDING_CONFIRMED')).toThrow(EscrowTransitionError);
  });
  it('cannot CANCEL once FUNDED (must REFUND — money has moved)', () => {
    expect(canApply('FUNDED', 'CANCEL')).toBe(false);
    expect(canApply('FUNDED', 'REFUND')).toBe(true);
  });
  it('terminal states reject all further events', () => {
    for (const status of ['RELEASED', 'REFUNDED', 'CANCELLED'] as const) {
      expect(isTerminal(status)).toBe(true);
      expect(() => applyEscrowEvent({ status }, 'RELEASE')).toThrow(EscrowTransitionError);
    }
  });
  it('can CANCEL while still in DRAFT / AWAITING_FUNDING', () => {
    expect(applyEscrowEvent({ status: 'DRAFT' }, 'CANCEL').state.status).toBe('CANCELLED');
    expect(applyEscrowEvent({ status: 'AWAITING_FUNDING' }, 'CANCEL').state.status).toBe('CANCELLED');
  });
});
