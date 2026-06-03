import { describe, it, expect } from 'vitest';
import {
  RailRouter,
  RailRoutingError,
  type PaymentRail,
  type RailCapabilities,
  type RouteCriteria,
} from '../src';

function fakeRail(id: string, cap: Partial<RailCapabilities>): PaymentRail {
  return {
    id,
    capabilities: {
      payIn: true, payOut: true, hold: false,
      countries: [], currencies: [], methods: [],
      ...cap,
    },
    async initiatePayIn() { return { railRef: `${id}-in`, status: 'pending' }; },
    async initiatePayout() { return { railRef: `${id}-out`, status: 'pending' }; },
    async getStatus(railRef) { return { railRef, status: 'pending' }; },
    parseWebhook() { return null; },
    verifyWebhook() { return true; },
  };
}

const pawapay = fakeRail('pawapay', {
  countries: ['CD'], currencies: ['CDF', 'USD'], methods: ['mobile_money'], hold: true,
});
const korapay = fakeRail('korapay', {
  countries: ['ZA'], currencies: ['ZAR'], methods: ['bank_transfer', 'card'], hold: true,
});

const crit = (o: Partial<RouteCriteria>): RouteCriteria => ({
  direction: 'payIn', country: 'CD', currency: 'CDF', method: 'mobile_money', ...o,
});

describe('rail selection by capability', () => {
  it('routes DRC mobile money to PawaPay and SA bank to Korapay', () => {
    const r = new RailRouter().register(pawapay).register(korapay);
    expect(r.select(crit({})).id).toBe('pawapay');
    expect(r.select(crit({ direction: 'payOut', country: 'ZA', currency: 'ZAR', method: 'bank_transfer' })).id).toBe('korapay');
  });

  it('throws when no rail supports the combo', () => {
    const r = new RailRouter().register(pawapay).register(korapay);
    expect(() => r.select(crit({ country: 'CD', currency: 'ZAR', method: 'card' }))).toThrow(RailRoutingError);
  });

  it('respects direction capability', () => {
    const collectOnly = fakeRail('collect-only', {
      payOut: false, countries: ['NG'], currencies: ['NGN'], methods: ['bank_transfer'],
    });
    const r = new RailRouter().register(collectOnly);
    expect(r.select(crit({ direction: 'payIn', country: 'NG', currency: 'NGN', method: 'bank_transfer' })).id).toBe('collect-only');
    expect(() => r.select(crit({ direction: 'payOut', country: 'NG', currency: 'NGN', method: 'bank_transfer' }))).toThrow(RailRoutingError);
  });
});

describe('enable / disable', () => {
  it('a disabled rail is not selected', () => {
    const r = new RailRouter().register(pawapay);
    r.setEnabled('pawapay', false);
    expect(r.candidates(crit({}))).toHaveLength(0);
    expect(() => r.select(crit({}))).toThrow(RailRoutingError);
    r.setEnabled('pawapay', true);
    expect(r.select(crit({})).id).toBe('pawapay');
  });

  it('setEnabled on an unknown rail throws', () => {
    expect(() => new RailRouter().setEnabled('nope', true)).toThrow(RailRoutingError);
  });
});

describe('failover by priority', () => {
  const primary = fakeRail('primary', { countries: ['ZA'], currencies: ['ZAR'], methods: ['bank_transfer'] });
  const backup = fakeRail('backup', { countries: ['ZA'], currencies: ['ZAR'], methods: ['bank_transfer'] });

  it('returns the highest-priority rail first, with failover order', () => {
    const r = new RailRouter()
      .register(primary, { priority: 10 })
      .register(backup, { priority: 20 });
    const c = crit({ country: 'ZA', currency: 'ZAR', method: 'bank_transfer' });
    expect(r.candidates(c).map((x) => x.id)).toEqual(['primary', 'backup']);
    expect(r.select(c).id).toBe('primary');

    r.setEnabled('primary', false); // failover
    expect(r.select(c).id).toBe('backup');
  });
});

describe('registration guards', () => {
  it('rejects duplicate rail ids', () => {
    const r = new RailRouter().register(pawapay);
    expect(() => r.register(pawapay)).toThrow(RailRoutingError);
  });
});
