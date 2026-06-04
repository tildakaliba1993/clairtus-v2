/**
 * OpenTelemetry tracing (M11). No-op until `OTEL_EXPORTER_OTLP_ENDPOINT` is set — so the API runs with
 * zero config, and turning on distributed tracing in prod is just pointing at a collector. The SDK is
 * loaded lazily so its weight isn't paid when disabled. Pairs with the correlation-id seam already in
 * `@clairtus/observability` (structured logs carry the request id; spans carry the trace id).
 */
let sdk: { shutdown: () => Promise<void> } | null = null;

/** Start the OTLP tracer if a collector endpoint is configured. Call once at bootstrap. */
export async function initTracing(): Promise<boolean> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint || sdk) return sdk !== null;
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const instance = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` }),
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
