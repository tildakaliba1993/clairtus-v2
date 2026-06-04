import { SetMetadata } from '@nestjs/common';

export const REQUIRE_IDEMPOTENCY_KEY = 'requireIdempotency';

/**
 * Marks a money-moving route as requiring an `Idempotency-Key` header. The IdempotencyInterceptor
 * rejects such a request with 400 when the header is absent, so a retried POST can never double-move
 * money by omitting the key. (Non-marked mutating routes keep idempotency optional.)
 */
export const RequireIdempotencyKey = (): MethodDecorator => SetMetadata(REQUIRE_IDEMPOTENCY_KEY, true);
