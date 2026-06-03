import type { PaymentRail } from './rail';
import type { Direction, PaymentMethod } from './types';

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
}

/**
 * Config-driven rail selection. A rail is eligible if it is enabled and its
 * capabilities cover the {direction, country, currency, method}. Rails can be
 * toggled on/off at runtime; multiple eligible rails are returned best-first for
 * failover.
 */
export class RailRouter {
  private readonly entries: Entry[] = [];

  register(rail: PaymentRail, opts: { enabled?: boolean; priority?: number } = {}): this {
    if (this.entries.some((e) => e.rail.id === rail.id)) {
      throw new RailRoutingError(`rail already registered: ${rail.id}`);
    }
    this.entries.push({ rail, enabled: opts.enabled ?? true, priority: opts.priority ?? 100 });
    return this;
  }

  setEnabled(id: string, enabled: boolean): void {
    const e = this.entries.find((x) => x.rail.id === id);
    if (!e) throw new RailRoutingError(`unknown rail: ${id}`);
    e.enabled = enabled;
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

  /** All enabled, eligible rails, best (lowest priority number) first — for failover. */
  candidates(c: RouteCriteria): PaymentRail[] {
    return this.entries
      .filter((e) => e.enabled && this.supports(e.rail, c))
      .sort((a, b) => a.priority - b.priority)
      .map((e) => e.rail);
  }

  /** The single best eligible rail, or throws RailRoutingError. */
  select(c: RouteCriteria): PaymentRail {
    const best = this.candidates(c)[0];
    if (!best) {
      throw new RailRoutingError(
        `no enabled rail supports ${c.direction} via ${c.method} in ${c.currency}/${c.country}`,
      );
    }
    return best;
  }
}
