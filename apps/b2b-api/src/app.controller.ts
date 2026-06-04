import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Public } from './common/public.decorator';
import { SQL, type SqlExecutor } from './db/sql';

@Controller()
export class AppController {
  constructor(@Inject(SQL) private readonly sql: SqlExecutor) {}

  /**
   * Liveness — static, never touches the DB. Fly's machine health check hits this, so a
   * transient DB blip can't flap the machine (that's what readiness is for).
   */
  @Public()
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }

  /**
   * Readiness — verifies the process can actually serve traffic by pinging the DB. Returns
   * 503 when the DB is unreachable, so orchestrators/monitors can route around a broken node.
   */
  @Public()
  @Get('ready')
  async ready(): Promise<{ status: string }> {
    try {
      await this.sql.query('select 1');
    } catch {
      throw new ServiceUnavailableException('database unreachable');
    }
    return { status: 'ready' };
  }
}
