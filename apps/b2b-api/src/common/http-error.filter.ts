import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

/**
 * Renders every error in one consistent envelope:
 *   { "error": { "code": "unauthorized", "message": "…", "statusCode": 401 } }
 * Unknown errors become a 500 without leaking internals.
 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    // Log server-side (5xx / non-HTTP) errors so they're never silently swallowed.
    if (!(exception instanceof HttpException) || status >= 500) {
      console.error('[HttpErrorFilter] unhandled error:', exception);
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
