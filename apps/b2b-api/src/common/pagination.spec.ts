import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, buildPage } from './pagination';

describe('cursor pagination', () => {
  it('round-trips an opaque cursor', () => {
    const c = { createdAt: '2026-06-03T00:00:00.000Z', id: 'abc' };
    const enc = encodeCursor(c);
    expect(enc).not.toContain('{'); // opaque, not raw JSON
    expect(decodeCursor(enc)).toEqual(c);
  });

  it('returns null for a malformed cursor', () => {
    expect(decodeCursor('not-base64-$$')).toBeNull();
    expect(decodeCursor(Buffer.from('{}', 'utf8').toString('base64url'))).toBeNull();
  });

  it('buildPage trims the limit+1 sentinel and emits a nextCursor', () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `id-${i}`, createdAt: `2026-06-0${i + 1}T00:00:00.000Z` }));
    const page = buildPage(rows, 2);
    expect(page.data.map((r) => r.id)).toEqual(['id-0', 'id-1']);
    expect(decodeCursor(page.nextCursor!)).toEqual({ id: 'id-1', createdAt: '2026-06-02T00:00:00.000Z' });
  });

  it('buildPage with no extra row has no nextCursor', () => {
    const rows = [{ id: 'a', createdAt: '2026-06-01T00:00:00.000Z' }];
    expect(buildPage(rows, 2).nextCursor).toBeNull();
  });
});
