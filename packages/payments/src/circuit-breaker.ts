export type BreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit opens. */
  failureThreshold?: number;
  /** How long the circuit stays open before allowing a trial request. */
  cooldownMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

/**
 * A per-rail circuit breaker. After `failureThreshold` consecutive failures the circuit
 * OPENS and requests are blocked (fail fast / fail over). After `cooldownMs` it allows one
 * HALF-OPEN trial: success closes it, failure re-opens it.
 */
export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private failures = 0;
  private openedAt = 0;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.threshold = opts.failureThreshold ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  /** Current state (transitions a cooled-down OPEN to HALF-OPEN as a side effect). */
  get currentState(): BreakerState {
    this.maybeHalfOpen();
    return this.state;
  }

  private maybeHalfOpen(): void {
    if (this.state === 'open' && this.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'half-open';
    }
  }

  /** Whether requests should be blocked right now. */
  blocked(): boolean {
    this.maybeHalfOpen();
    return this.state === 'open';
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.state === 'half-open' || this.failures >= this.threshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }
}
