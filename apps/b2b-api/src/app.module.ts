import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Tenancy } from '@clairtus/tenancy';
import { AppController } from './app.controller';
import { SystemController } from './system/system.controller';
import { EscrowController } from './escrow/escrow.controller';
import { PartyController } from './escrow/party.controller';
import { PayoutController } from './escrow/payout.controller';
import { AccountController } from './escrow/account.controller';
import { EscrowService } from './escrow/escrow.service';
import { WebhookController } from './webhooks/webhook.controller';
import { WebhookService } from './webhooks/webhook.service';
import { KycController } from './kyc/kyc.controller';
import { KycService } from './kyc/kyc.service';
import { SimulatedRail, KorapayRail, type PaymentRail } from '@clairtus/payments';
import { SmileIdProvider, type KycProvider } from '@clairtus/kyc';
import { SQL, RAIL, SIMULATED_RAIL, FETCH, KYC_PROVIDER, KYC_CALLBACK_URL, KYC_RELEASE_THRESHOLD, UNCONFIGURED_SQL, type SqlExecutor } from './db/sql';
import { connectPostgres } from './db/postgres';
import { ApiKeyGuard } from './common/api-key.guard';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { HttpErrorFilter } from './common/http-error.filter';

// Production providers are env-driven: real adapters when configured, safe defaults otherwise.
// Tests override SQL/RAIL/KYC_PROVIDER/FETCH directly, so these factories don't run there.
function sqlFromEnv(): SqlExecutor {
  const url = process.env.DATABASE_URL;
  return url ? connectPostgres(url).executor : UNCONFIGURED_SQL;
}
function liveRailFromEnv(): PaymentRail | null {
  const secretKey = process.env.KORAPAY_SECRET_KEY;
  if (!secretKey) return null;
  return new KorapayRail({
    baseUrl: process.env.KORAPAY_BASE_URL ?? 'https://api.korapay.com',
    secretKey,
    notificationUrl: process.env.KORAPAY_WEBHOOK_URL,
  });
}
function kycFromEnv(): KycProvider | null {
  const partnerId = process.env.SMILE_ID_PARTNER_ID;
  const apiKey = process.env.SMILE_ID_API_KEY;
  if (!partnerId || !apiKey) return null;
  const sandbox = process.env.SMILE_ID_SANDBOX !== 'false';
  return new SmileIdProvider({
    baseUrl: sandbox ? 'https://testapi.smileidentity.com' : 'https://api.smileidentity.com',
    partnerId,
    apiKey,
    country: process.env.SMILE_ID_COUNTRY,
    idType: process.env.SMILE_ID_ID_TYPE,
  });
}

@Module({
  controllers: [
    AppController,
    SystemController,
    EscrowController,
    PartyController,
    PayoutController,
    AccountController,
    WebhookController,
    KycController,
  ],
  providers: [
    // Database executor — Postgres (DATABASE_URL) in prod, pglite override in tests.
    { provide: SQL, useFactory: sqlFromEnv },
    // Live payout rail — Korapay when KORAPAY_SECRET_KEY is set; null otherwise (sandbox uses SIMULATED_RAIL).
    { provide: RAIL, useFactory: liveRailFromEnv },
    // Sandbox rail for test-mode keys — always available (deterministic, no network).
    { provide: SIMULATED_RAIL, useValue: new SimulatedRail() },
    // fetch used for outbound webhook delivery (overridden with a fake in tests).
    { provide: FETCH, useValue: globalThis.fetch },
    // KYC: Smile ID when configured; releases above the threshold (minor units) require a VERIFIED seller.
    { provide: KYC_PROVIDER, useFactory: kycFromEnv },
    { provide: KYC_CALLBACK_URL, useValue: process.env.KYC_CALLBACK_URL ?? 'https://api.clairtus.example/v1/kyc/callback' },
    { provide: KYC_RELEASE_THRESHOLD, useValue: Number(process.env.KYC_RELEASE_THRESHOLD ?? 1_000_000) },
    { provide: Tenancy, useFactory: (sql: SqlExecutor) => new Tenancy(sql), inject: [SQL] },
    EscrowService,
    WebhookService,
    KycService,
    // Cross-cutting: auth on every route, idempotent money ops, one error envelope.
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: HttpErrorFilter },
  ],
})
export class AppModule {}
