import { describe, it, expect } from 'vitest';
import { captureException, isErrorTrackingEnabled, initErrorTracking } from './error-tracking';

describe('error tracking (no-op until SENTRY_DSN is set)', () => {
  it('is disabled when no DSN is configured', async () => {
    delete process.env.SENTRY_DSN;
    const enabled = await initErrorTracking();
    expect(enabled).toBe(false);
    expect(isErrorTrackingEnabled()).toBe(false);
  });

  it('captureException is a safe no-op when disabled', () => {
    expect(() => captureException(new Error('boom'), { correlationId: 'abc' })).not.toThrow();
  });
});
