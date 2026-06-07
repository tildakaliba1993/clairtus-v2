import { describe, it, expect } from 'vitest';
import { initTracing, isTracingEnabled, tracingInstrumentations } from './tracing';

describe('OpenTelemetry tracing (no-op until configured)', () => {
  it('is disabled (and loads nothing) when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    expect(await initTracing()).toBe(false);
    expect(isTracingEnabled()).toBe(false);
  });

  it('registers auto-instrumentations (HTTP/pg spans), not an empty set (B2)', async () => {
    const instrs = await tracingInstrumentations();
    // Before B2 the NodeSDK had no instrumentations → empty traces. Now it auto-instruments.
    expect(Array.isArray(instrs)).toBe(true);
    expect(instrs.length).toBeGreaterThan(0);
  });
});
