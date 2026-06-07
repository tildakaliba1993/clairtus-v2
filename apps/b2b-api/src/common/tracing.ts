/**
 * OpenTelemetry tracing (M11 + B2). No-op until `OTEL_EXPORTER_OTLP_ENDPOINT` is set — so the API runs
 * with zero config, and turning on distributed tracing in prod is just pointing at a collector. The SDK
 * and instrumentations are loaded lazily so their weight isn't paid when disabled. Pairs with the
 * correlation-id seam in `@clairtus/observability` (structured logs carry the request id; spans carry
 * the trace id).
 *
 * Spans come from `@opentelemetry/auto-instrumentations-node` — without instrumentations the SDK exports
 * an empty trace stream (the B2 gap). Auto-instrumentation captures incoming/outgoing HTTP and Postgres
 * (`pg`) spans out of the box; `fs` is disabled (extremely noisy for an HTTP/DB service).
 */
const SERVICE_NAME = 'clairtus-b2b-api';

let sdk: { shutdown: () => Promise<void> } | null = null;

/** Build the auto-instrumentation set the tracer registers. Exposed so the wiring is testable. */
export async function tracingInstrumentations(): Promise<unknown[]> {
  const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
  return getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { enabled: false },
  });
}

/** Start the OTLP tracer if a collector endpoint is configured. Call once at bootstrap. */
export async function initTracing(): Promise<boolean> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint || sdk) return sdk !== null;
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const { resourceFromAttributes } = await import('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME } = await import('@opentelemetry/semantic-conventions');
  const instance = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: SERVICE_NAME }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` }),
    instrumentations: (await tracingInstrumentations()) as never,
  });
  instance.start();
  sdk = instance;
  return true;
}

export function isTracingEnabled(): boolean {
  return sdk !== null;
}

export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}
