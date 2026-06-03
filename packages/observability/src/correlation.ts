import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface Context {
  correlationId: string;
}

const storage = new AsyncLocalStorage<Context>();

export function newCorrelationId(): string {
  return randomUUID();
}

/** Run `fn` within a correlation context — the id propagates across all awaited async calls. */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

/** The current correlation id, or undefined outside any context. */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
