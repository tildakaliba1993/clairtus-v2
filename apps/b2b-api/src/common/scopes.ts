import { SetMetadata } from '@nestjs/common';

/**
 * Canonical API-key scope catalogue. Keys carry a subset of these; a route declares the scope it
 * needs with `@Scopes(...)` and the ApiKeyGuard rejects keys that lack it (403).
 *
 * Convention: `<resource>:<action>`. We gate **write/money** routes plus a small set of
 * operator-only reads (`ops:read`) — ordinary reads require a valid key but no scope, so a read-only
 * integration (e.g. the dashboard) works with any key.
 */
export const SCOPES = {
  escrowsWrite: 'escrows:write',
  partiesWrite: 'parties:write',
  payoutsWrite: 'payouts:write',
  kycWrite: 'kyc:write',
  keysRead: 'keys:read',
  keysWrite: 'keys:write',
  /** Operator-only: system-wide operational metrics. NOT granted to standard tenant keys. */
  opsRead: 'ops:read',
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

/**
 * Full set granted to a standard onboarding key (test + live) — the tenant's primary/admin key. Includes
 * `keys:*` so it can manage its own tenant's keys; narrower keys it mints won't have `keys:*` unless granted.
 */
export const DEFAULT_WRITE_SCOPES: Scope[] = [
  SCOPES.escrowsWrite,
  SCOPES.partiesWrite,
  SCOPES.payoutsWrite,
  SCOPES.kycWrite,
  SCOPES.keysRead,
  SCOPES.keysWrite,
];

export const SCOPES_KEY = 'requiredScopes';

/** Declares the scope(s) a route requires. The ApiKeyGuard enforces them after authentication. */
export const Scopes = (...scopes: Scope[]): MethodDecorator & ClassDecorator =>
  SetMetadata(SCOPES_KEY, scopes);
