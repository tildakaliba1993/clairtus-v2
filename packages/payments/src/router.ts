import type { PaymentRail } from './rail';
import type { Direction, PaymentMethod } from './types';
import { CircuitBreaker, type CircuitBreakerOptions, type BreakerState } from './circuit-breaker';

export class RailRoutingError extends Error {}

export interface RouteCriteria {
  direction: Direction;
  country: string;
  currency: string;
  method: PaymentMethod;
  /** Optional — reserved for future amount-based routing/limits. */
  amount?: number;
}

interface Entry {
  rail: PaymentRail;
  enabled: boolean;
  /** Lower number = higher priority (tried first). */
  priority: number;
  breaker: CircuitBreaker;
}

/**
 * Config-driven rail selection with per-rail circuit breakers. A rail is eligible if it is
 * enabled, its capabilities cover the {direction, country, currency, method}, AND its breaker
 * is not open. Multiple eligible rails are returned best-first for failover; `run()` executes
 * a call against them in order, recording success/failure on each breaker.
 */
export class RailRouter {
  private readonly entries: Entry[] = [];

  constructor(private readonly opts: { breaker?: CircuitBreakerOptions } = {}) {}

  register(rail: PaymentRail, opts: { enabled?: boolean; priority?: number } = {}): this {
    if (this.entries.some((e) => e.rail.id === rail.id)) {
      throw new RailRoutingError(`rail already registered: ${rail.id}`);
    }
    this.entries.push({
      rail,
      enabled: opts.enabled ?? true,
      priority: opts.priority ?? 100,
      breaker: new CircuitBreaker(this.opts.breaker),
    });
    return this;
  }

  setEnabled(id: string, enabled: boolean): void {
    this.entry(id).enabled = enabled;
  }

  private entry(id: string): Entry {
    const e = this.entries.find((x) => x.rail.id === id);
    if (!e) throw new RailRoutingError(`unknown rail: ${id}`);
    return e;
  }

  /** Inspect a rail's breaker state (observability). */
  breakerState(id: string): BreakerState {
    return this.entry(id).breaker.currentState;
  }

  private supports(rail: PaymentRail, c: RouteCriteria): boolean {
    const cap = rail.capabilities;
    if (c.direction === 'payIn' && !cap.payIn) return false;
    if (c.direction === 'payOut' && !cap.payOut) return false;
    return (
      cap.countries.includes(c.country) &&
      cap.currencies.includes(c.currency) &&
      cap.methods.includes(c.method)
    );
  }

  /** All enabled, eligible rails whose breaker is closed, best (lowest priority) first. */
  candidates(c: RouteCriteria): PaymentRail[] {
    return this.entries
      .filter((e) => e.enabled && !e.breaker.blocked() && this.supports(e.rail, c))
      .sort((a, b) => a.priority - b.priority)
      .map((e) => e.rail);
  }

  /** The single best eligible rail, or throws RailRoutingError. */
  select(c: RouteCriteria): PaymentRail {
    const best = this.candidates(c)[0];
    if (!best) {
      throw new RailRoutingError(
        `no available rail supports ${c.direction} via ${c.method} in ${c.currency}/${c.country}`,
      );
    }
    return best;
  }

  /**
   * Execute `fn` against eligible rails best-first, failing over on error. Each rail's breaker
   * records the outcome, so a repeatedly-failing rail opens its circuit and is skipped until it
   * cools down. Throws RailRoutingError if no candidate succeeds.
   */
  async run<T>(c: RouteCriteria, fn: (rail: PaymentRail) => Promise<T>): Promise<T> {
    const cands = this.candidates(c);
    if (cands.length === 0) {
      throw new RailRoutingError(
        `no available rail supports ${c.direction} via ${c.method} in ${c.currency}/${c.country}`,
      );
    }
    let lastError: unknown;
    for (const rail of cands) {
      const breaker = this.entry(rail.id).breaker;
      try {
        const result = await fn(rail);
        breaker.recordSuccess();
        return result;
      } catch (err) {
        breaker.recordFailure();
        lastError = err;
      }
    }
    throw new RailRoutingError(
      `all candidate rails failed for ${c.direction} in ${c.currency}/${c.country}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }
}
