import { describe, it, expect } from 'vitest';
import { SimulatedRail, type PayoutRequest, type PayInRequest } from '../src';

const rail = new SimulatedRail();
const payout = (metadata?: Record<string, unknown>): PayoutRequest => ({
  reference: 'po-1', amount: 50000, currency: 'ZAR', country: 'ZA', method: 'bank_transfer',
  recipient: { accountRef: '0000000000', bankCode: '033' }, metadata,
});

describe('SimulatedRail', () => {
  it('implements PaymentRail with hold capability', () => {
    expect(rail.id).toBe('simulated');
    expect(rail.capabilities.hold).toBe(true);
    expect(rail.capabilities.payOut).toBe(true);
  });

  it('payout succeeds by default, with a deterministic railRef', async () => {
    const res = await rail.initiatePayout(payout());
    expect(res).toEqual({ railRef: 'sim_po_po-1', status: 'succeeded' });
  });

  it('payout outcome is driven by metadata.simulate', async () => {
    expect((await rail.initiatePayout(payout({ simulate: 'failed' }))).status).toBe('failed');
    expect((await rail.initiatePayout(payout({ simulate: 'pending' }))).status).toBe('pending');
    expect((await rail.initiatePayout(payout({ simulate: 'succeeded' }))).status).toBe('succeeded');
  });

  it('pay-in returns a simulated virtual account', async () => {
    const req: PayInRequest = { reference: 'pi-1', amount: 1000, currency: 'ZAR', country: 'ZA', method: 'bank_transfer', payer: {} };
    const res = await rail.initiatePayIn(req);
    expect(res).toMatchObject({ railRef: 'sim_pi_pi-1', status: 'succeeded', instructions: { type: 'virtual_account' } });
  });

  it('parses a simulated webhook into a NormalizedEvent; ignores unknown', () => {
    expect(rail.parseWebhook({ event: 'payout.succeeded', reference: 'po-1' }))
      .toMatchObject({ type: 'payout.succeeded', railRef: 'po-1', reference: 'po-1' });
    expect(rail.parseWebhook({ event: 'nope', reference: 'x' })).toBeNull();
    expect(rail.parseWebhook(null)).toBeNull();
    expect(rail.verifyWebhook()).toBe(true);
  });
});
