import { describe, it, expect } from 'vitest';
import { CircuitBreaker, RailRouter, type PaymentRail, type RouteCriteria } from '../src';

describe('CircuitBreaker', () => {
  it('opens after the failure threshold and blocks', () => {
    let t = 0;
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => t });
    expect(cb.blocked()).toBe(false);
    cb.recordFailure(); cb.recordFailure();
    expect(cb.currentState).toBe('closed'); // 2 < 3
    cb.recordFailure();
    expect(cb.currentState).toBe('open');
    expect(cb.blocked()).toBe(true);
  });

  it('half-opens after cooldown, then closes on success', () => {
    let t = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => t });
    cb.recordFailure();
    expect(cb.blocked()).toBe(true);
    t = 1000; // cooldown elapsed
    expect(cb.blocked()).toBe(false);
    expect(cb.currentState).toBe('half-open');
    cb.recordSuccess();
    expect(cb.currentState).toBe('closed');
  });

  it('re-opens if the half-open trial fails', () => {
    let t = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => t });
    cb.recordFailure();
    t = 1000;
    expect(cb.currentState).toBe('half-open');
    cb.recordFailure();
    t = 1500;
    expect(cb.blocked()).toBe(true); // re-opened, not yet cooled again
  });
});

// A fake rail that fails or succeeds on demand, counting calls.
function fakeRail(id: string, behavior: { fail: boolean }): PaymentRail & { calls: number } {
  const caps = { payIn: true, payOut: true, hold: true, countries: ['ZA'], currencies: ['ZAR'], methods: ['bank_transfer'] as const };
  return {
    id,
    capabilities: caps,
    calls: 0,
    async initiatePayIn() { return { railRef: 'x', status: 'succeeded' }; },
    async initiatePayout(this: { calls: number }) {
      (this as any).calls++;
      if (behavior.fail) throw new Error(`${id} down`);
      return { railRef: `${id}-ok`, status: 'succeeded' };
    },
    async getStatus(ref: string) { return { railRef: ref, status: 'succeeded' as const }; },
    parseWebhook() { return null; },
    verifyWebhook() { return true; },
  } as PaymentRail & { calls: number };
}

const crit: RouteCriteria = { direction: 'payOut', country: 'ZA', currency: 'ZAR', method: 'bank_transfer' };

describe('RailRouter with circuit breakers (failover)', () => {
  it('fails over to a healthy rail and opens the broken rail\'s circuit', async () => {
    let t = 0;
    const a = fakeRail('a', { fail: true });
    const b = fakeRail('b', { fail: false });
    const router = new RailRouter({ breaker: { failureThreshold: 3, cooldownMs: 1000, now: () => t } });
    router.register(a, { priority: 1 }).register(b, { priority: 2 });

    // 3 calls: each tries A (fails) then B (succeeds). After 3 A-failures, A's breaker opens.
    for (let i = 0; i < 3; i++) {
      const res = await router.run(crit, (rail) => rail.initiatePayout({ reference: `r${i}`, amount: 1000, currency: 'ZAR', country: 'ZA', method: 'bank_transfer', recipient: {} }));
      expect(res.railRef).toBe('b-ok');
    }
    expect(router.breakerState('a')).toBe('open');
    expect(a.calls).toBe(3);

    // Next call skips A entirely (breaker open) — A is no longer a candidate.
    await router.run(crit, (rail) => rail.initiatePayout({ reference: 'r4', amount: 1000, currency: 'ZAR', country: 'ZA', method: 'bank_transfer', recipient: {} }));
    expect(a.calls).toBe(3); // unchanged — A was skipped

    // After cooldown, A is retried (half-open) and, since it still fails, B serves again.
    t = 1000;
    await router.run(crit, (rail) => rail.initiatePayout({ reference: 'r5', amount: 1000, currency: 'ZAR', country: 'ZA', method: 'bank_transfer', recipient: {} }));
    expect(a.calls).toBe(4); // A got one trial
  });

  it('throws when all candidate rails fail', async () => {
    const a = fakeRail('a', { fail: true });
    const router = new RailRouter({ breaker: { failureThreshold: 5 } });
    router.register(a);
    await expect(router.run(crit, (rail) => rail.initiatePayout({ reference: 'r', amount: 1, currency: 'ZAR', country: 'ZA', method: 'bank_transfer', recipient: {} })))
      .rejects.toThrow(/all candidate rails failed/);
  });
});
