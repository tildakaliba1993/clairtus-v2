import { runWithCorrelationId, newCorrelationId } from '@clairtus/observability';

interface MinReq { headers: Record<string, string | string[] | undefined> }
interface MinRes { setHeader: (key: string, value: string) => void }

/**
 * Express middleware: assigns/propagates a correlation (request) id for the whole request,
 * echoes it on `X-Request-Id`, and runs the handler chain inside the correlation context so
 * every structured log line for this request carries the same id (trace correlation).
 */
export function correlationMiddleware(req: MinReq, res: MinRes, next: () => void): void {
  const header = req.headers['x-request-id'];
  const id = (typeof header === 'string' && header.length > 0 ? header : newCorrelationId());
  res.setHeader('X-Request-Id', id);
  runWithCorrelationId(id, () => next());
}
