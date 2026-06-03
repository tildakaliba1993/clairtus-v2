import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Marks a route as not requiring API-key authentication (e.g. health checks). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
