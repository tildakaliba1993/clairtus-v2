import { SetMetadata } from '@nestjs/common';

/**
 * Canonical API-key scope catalogue. Keys carry a subset of these; a route declares the scope it
 * needs with `@Scopes(...)` and the ApiKeyGuard rejects keys that lack it (403).
 *
 * Convention: `<resource>:<action>`. We currently gate **write/money** routes only — reads require a
 * valid key but no scope, so a read-only integration (e.g. the dashboard) works with any key.
 */
export const SCOPES = {
  escrowsWrite: 'escrows:write',
  partiesWrite: 'parties:write',
  payoutsWrite: 'payouts:write',
  kycWrite: 'kyc:write',
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

/** Full write set granted to a standard onboarding key (test + live). */
export const DEFAULT_WRITE_SCOPES: Scope[] = [
  SCOPES.escrowsWrite,
  SCOPES.partiesWrite,
  SCOPES.payoutsWrite,
  SCOPES.kycWrite,
];

export const SCOPES_KEY = 'requiredScopes';

/** Declares the scope(s) a route requires. The ApiKeyGuard enforces them after authentication. */
export const Scopes = (...scopes: Scope[]): MethodDecorator & ClassDecorator =>
  SetMetadata(SCOPES_KEY, scopes);
