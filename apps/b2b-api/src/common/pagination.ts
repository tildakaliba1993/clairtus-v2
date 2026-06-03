/**
 * Opaque cursor pagination. A cursor encodes the last row's (createdAt, id) so the next
 * page is `where (created_at, id) < (cursor)` — stable under inserts, unlike offsets.
 */
export interface Cursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const obj = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (obj && typeof obj.createdAt === 'string' && typeof obj.id === 'string') return obj as Cursor;
    return null;
  } catch {
    return null;
  }
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

/**
 * Slices `rows` (already fetched as limit+1) into a page envelope. If more than `limit`
 * rows came back, the extra row signals there's a next page and yields the cursor.
 */
export function buildPage<T extends Cursor>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return { data, nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null };
}
