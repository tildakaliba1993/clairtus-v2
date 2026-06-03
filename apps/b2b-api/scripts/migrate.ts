/**
 * Apply database migrations. Run before the API starts (Fly release_command / CI deploy step):
 *   DATABASE_URL=postgres://… pnpm --filter @clairtus/b2b-api migrate
 */
import { connectPostgres } from '../src/db/postgres';
import { migrate } from '../src/db/migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const { executor, close } = connectPostgres(url);
migrate(executor)
  .then(async () => {
    console.log('✓ migrations applied');
    await close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('✗ migration failed:', err);
    await close().catch(() => {});
    process.exit(1);
  });
