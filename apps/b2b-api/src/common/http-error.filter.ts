import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { getCorrelationId } from '@clairtus/observability';
import { captureException } from './error-tracking';

/**
 * Renders every error in one consistent envelope:
 *   { "error": { "code": "unauthorized", "message": "…", "statusCode": 401 } }
 * Unknown errors become a 500 without leaking internals. Server-side (5xx / non-HTTP) errors are
 * logged and reported to Sentry (when enabled), tagged with the request's correlation id.
 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    // Log + report server-side (5xx / non-HTTP) errors so they're never silently swallowed.
    if (!(exception instanceof HttpException) || status >= 500) {
      console.error('[HttpErrorFilter] unhandled error:', exception);
      captureException(exception, { correlationId: getCorrelationId(), statusCode: status });
    }

    let message = 'Internal server error';
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : ((body as { message?: string | string[] }).message as string) ?? exception.message;
      if (Array.isArray(message)) message = message.join('; ');
    }

    const code = HttpStatus[status]?.toLowerCase() ?? 'error';
    res.status(status).json({ error: { code, message, statusCode: status } });
  }
}
