import { describe, it, expect } from 'vitest';
import { runWithCorrelationId, getCorrelationId, newCorrelationId, createLogger, type LogRecord } from '../src';

describe('correlation context', () => {
  it('has no id outside a context', () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it('propagates the id across awaited async calls', async () => {
    const seen: (string | undefined)[] = [];
    async function deep() {
      await Promise.resolve();
      seen.push(getCorrelationId());
    }
    await runWithCorrelationId('corr-123', async () => {
      seen.push(getCorrelationId());
      await deep();
    });
    expect(seen).toEqual(['corr-123', 'corr-123']);
    expect(getCorrelationId()).toBeUndefined(); // context ends after run
  });

  it('newCorrelationId returns a uuid', () => {
    expect(newCorrelationId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('structured logger', () => {
  it('emits structured records stamped with the correlation id + base fields', () => {
    const records: LogRecord[] = [];
    const log = createLogger({ sink: { write: (r) => records.push(r) }, base: { service: 'b2b-api' }, now: () => 0 });

    runWithCorrelationId('corr-9', () => {
      log.info('escrow funded', { escrowId: 'e1', amount: 100000 });
    });
    log.warn('outside context');

    expect(records[0]).toMatchObject({
      level: 'info', msg: 'escrow funded', service: 'b2b-api',
      correlationId: 'corr-9', escrowId: 'e1', amount: 100000,
      time: '1970-01-01T00:00:00.000Z',
    });
    expect(records[1]!.correlationId).toBeUndefined(); // no context → no id
    expect(records[1]).toMatchObject({ level: 'warn', msg: 'outside context', service: 'b2b-api' });
  });
});
