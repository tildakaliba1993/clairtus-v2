/**
 * Thin error-tracking wrapper around Sentry. It's a no-op until `SENTRY_DSN` is set — so the API runs
 * (and tests pass) with zero config, and turning on error tracking in prod is just setting the secret.
 * Sentry is loaded lazily so its weight isn't paid when disabled.
 */
let client: typeof import('@sentry/node') | null = null;

/** Initialise Sentry if a DSN is configured. Call once at bootstrap. Returns whether it's enabled. */
export async function initErrorTracking(): Promise<boolean> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || client) return client !== null;
  const Sentry = await import('@sentry/node');
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0, // errors only for now; turn on tracing later (M11/OTel)
  });
  client = Sentry;
  return true;
}

/** Report an exception (with optional context). No-op when error tracking is disabled. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!client) return;
  client.captureException(error, context ? { extra: context } : undefined);
}

export function isErrorTrackingEnabled(): boolean {
  return client !== null;
}
