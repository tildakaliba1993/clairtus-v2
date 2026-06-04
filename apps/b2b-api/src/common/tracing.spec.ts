import { describe, it, expect } from 'vitest';
import { initTracing, isTracingEnabled } from './tracing';

describe('OpenTelemetry tracing (no-op until configured)', () => {
  it('is disabled (and loads nothing) when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    expect(await initTracing()).toBe(false);
    expect(isTracingEnabled()).toBe(false);
  });
});
