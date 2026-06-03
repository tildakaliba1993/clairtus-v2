import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Tenancy } from '@clairtus/tenancy';
import { AppController } from './app.controller';
import { SystemController } from './system/system.controller';
import { SQL, UNCONFIGURED_SQL, type SqlExecutor } from './db/sql';
import { ApiKeyGuard } from './common/api-key.guard';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { HttpErrorFilter } from './common/http-error.filter';

@Module({
  controllers: [AppController, SystemController],
  providers: [
    // Database executor — overridden with pglite in tests, a Postgres adapter in prod.
    { provide: SQL, useValue: UNCONFIGURED_SQL },
    { provide: Tenancy, useFactory: (sql: SqlExecutor) => new Tenancy(sql), inject: [SQL] },
    // Cross-cutting: auth on every route, idempotent money ops, one error envelope.
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: HttpErrorFilter },
  ],
})
export class AppModule {}
