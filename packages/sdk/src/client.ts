/** Minimal typed client for the Clairtus B2B API. Framework-free; inject any fetch. */

export interface ClairtusClientOptions {
  baseUrl: string; // e.g. https://api.clairtus.example/v1
  apiKey: string; // ck_test_… or ck_live_…
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  /** Sent as Idempotency-Key on money-moving POSTs (safe to retry). */
  idempotencyKey?: string;
}

export type FeeResponsibility = 'SELLER' | 'BUYER' | 'SPLIT';

export interface CreateEscrowInput {
  baseAmount: number;
  currency: string;
  feeBps: number;
  feeResponsibility: FeeResponsibility;
  buyerPartyId?: string;
  sellerPartyId: string;
  secondaryPartyId?: string;
  secondaryAmount?: number;
}
export interface CreatePartyInput {
  role: string;
  name?: string;
  phone?: string;
  accountRef?: string;
  bankCode?: string;
}
export interface CreatePayoutInput {
  escrowId: string;
  recipientPartyId: string;
  amount: number;
  metadata?: Record<string, unknown>;
}
export interface CreateKycCheckInput {
  partyId: string;
  level?: 'biometric' | 'document';
}

/** Cursor-pagination query for list endpoints. */
export interface ListParams {
  limit?: number;
  cursor?: string;
}
/** A page of results. Pass `nextCursor` back as `cursor` to fetch the next page (null = last page). */
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

/** Thrown on any non-2xx response, carrying the API's error envelope. */
export class ClairtusApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ClairtusApiError';
  }
}

export class ClairtusClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClairtusClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: RequestOptions,
    autoIdempotency = false,
  ): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // Money-moving POSTs require an Idempotency-Key; if the caller didn't supply one, generate a
    // per-call key so a single logical call is safe to retry. (Reuse your own key across manual
    // retries by passing opts.idempotencyKey.)
    const idempotencyKey = opts?.idempotencyKey ?? (autoIdempotency ? globalThis.crypto.randomUUID() : undefined);
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = json?.error ?? {};
      throw new ClairtusApiError(res.status, err.code ?? 'error', err.message ?? res.statusText);
    }
    return json as T;
  }

  /** Build a `?limit=&cursor=` query string from list params (empty when none). */
  private qs(params?: ListParams): string {
    const q = new URLSearchParams();
    if (params?.limit !== undefined) q.set('limit', String(params.limit));
    if (params?.cursor) q.set('cursor', params.cursor);
    const s = q.toString();
    return s ? `?${s}` : '';
  }

  readonly parties = {
    create: (input: CreatePartyInput, opts?: RequestOptions) => this.request('POST', '/parties', input, opts),
    get: (id: string) => this.request('GET', `/parties/${id}`),
  };

  readonly escrows = {
    create: (input: CreateEscrowInput, opts?: RequestOptions) => this.request('POST', '/escrows', input, opts),
    list: <T = unknown>(params?: ListParams) => this.request<Page<T>>('GET', `/escrows${this.qs(params)}`),
    get: (id: string) => this.request('GET', `/escrows/${id}`),
    fund: (id: string, opts?: RequestOptions) => this.request('POST', `/escrows/${id}/fund`, {}, opts, true),
    release: (id: string, opts?: RequestOptions) => this.request('POST', `/escrows/${id}/release`, {}, opts, true),
    refund: (id: string, opts?: RequestOptions) => this.request('POST', `/escrows/${id}/refund`, {}, opts, true),
    cancel: (id: string, opts?: RequestOptions) => this.request('POST', `/escrows/${id}/cancel`, {}, opts),
    dispute: (id: string, opts?: RequestOptions) => this.request('POST', `/escrows/${id}/dispute`, {}, opts),
  };

  readonly payouts = {
    create: (input: CreatePayoutInput, opts?: RequestOptions) => this.request('POST', '/payouts', input, opts, true),
    list: <T = unknown>(params?: ListParams) => this.request<Page<T>>('GET', `/payouts${this.qs(params)}`),
    get: (id: string) => this.request('GET', `/payouts/${id}`),
  };

  readonly kyc = {
    createCheck: (input: CreateKycCheckInput, opts?: RequestOptions) => this.request('POST', '/kyc/checks', input, opts),
    getCheck: (id: string) => this.request('GET', `/kyc/checks/${id}`),
  };

  readonly webhookEndpoints = {
    create: (input: { url: string }) => this.request('POST', '/webhook-endpoints', input),
  };

  readonly webhookDeliveries = {
    list: () => this.request('GET', '/webhook-deliveries'),
    replay: (id: string) => this.request('POST', `/webhook-deliveries/${id}/replay`, {}),
  };

  balances = () => this.request('GET', '/balances');
  ledger = <T = unknown>(params?: ListParams) => this.request<Page<T>>('GET', `/ledger${this.qs(params)}`);
}
