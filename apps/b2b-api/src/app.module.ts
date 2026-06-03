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
import { SQL, RAIL, FETCH, KYC_PROVIDER, KYC_CALLBACK_URL, KYC_RELEASE_THRESHOLD, UNCONFIGURED_SQL, type SqlExecutor } from './db/sql';
import { ApiKeyGuard } from './common/api-key.guard';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { HttpErrorFilter } from './common/http-error.filter';

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
    // Database executor — overridden with pglite in tests, a Postgres adapter in prod.
    { provide: SQL, useValue: UNCONFIGURED_SQL },
    // Payout rail — null by default (payouts only post to the ledger); a PaymentRail in prod/tests.
    { provide: RAIL, useValue: null },
    // fetch used for outbound webhook delivery (overridden with a fake in tests).
    { provide: FETCH, useValue: globalThis.fetch },
    // KYC: provider null until configured; releases above the threshold (minor units) require a VERIFIED seller.
    { provide: KYC_PROVIDER, useValue: null },
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
