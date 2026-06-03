import { ClairtusClient } from '@clairtus/sdk';

/** Base URL of the B2B API (defaults to a local dev server). */
export function apiBaseUrl(): string {
  return process.env.CLAIRTUS_API_URL ?? 'http://localhost:3000/v1';
}

/** A server-side SDK client bound to the tenant's API key. */
export function makeClient(apiKey: string): ClairtusClient {
  return new ClairtusClient({ baseUrl: apiBaseUrl(), apiKey });
}
