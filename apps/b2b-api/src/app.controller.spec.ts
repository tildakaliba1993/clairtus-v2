import { describe, it, expect } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import type { SqlExecutor } from './db/sql';
import { AppController } from './app.controller';

/** A fake executor whose `select 1` either resolves or rejects, to drive readiness. */
function fakeSql(behaviour: 'ok' | 'down'): SqlExecutor {
  return {
    async query<T = Record<string, unknown>>(): Promise<{ rows: T[] }> {
      if (behaviour === 'down') throw new Error('connection refused');
      return { rows: [] as T[] };
    },
    async transaction<T>(): Promise<T> {
      throw new Error('not used');
    },
  };
}

describe('AppController', () => {
  it('liveness /health is static and never touches the DB', () => {
    const ctrl = new AppController(fakeSql('down'));
    expect(ctrl.health()).toEqual({ status: 'ok' });
  });

  it('readiness /ready returns ready when the DB answers', async () => {
    const ctrl = new AppController(fakeSql('ok'));
    await expect(ctrl.ready()).resolves.toEqual({ status: 'ready' });
  });

  it('readiness /ready returns 503 (ServiceUnavailable) when the DB is unreachable', async () => {
    const ctrl = new AppController(fakeSql('down'));
    await expect(ctrl.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
