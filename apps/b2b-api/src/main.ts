import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Production bootstrap. NOTE: a Postgres SqlExecutor must be wired in (override the SQL
// provider) before money endpoints work — the default throws. Tracked for T3.3 deploy.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();
