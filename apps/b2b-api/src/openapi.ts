import { DocumentBuilder } from '@nestjs/swagger';

/** OpenAPI document config for the B2B API reference (served at /docs). */
export function buildOpenApiConfig() {
  return new DocumentBuilder()
    .setTitle('Clairtus B2B Escrow API')
    .setDescription(
      'Escrow infrastructure API: create escrows, fund, release/refund, pay out from balance, ' +
        'manage parties, run KYC, and receive signed webhooks. Authenticate with a bearer API key ' +
        '(`ck_test_…` for sandbox, `ck_live_…` for production).',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'API key' }, 'api-key')
    .build();
}
