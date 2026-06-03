import { createHmac } from 'node:crypto';
import type {
  KycProvider,
  NormalizedKycResult,
  StartVerificationRequest,
  StartVerificationResult,
  KycStatus,
} from './types';

/**
 * Smile ID adapter — ported from the live B2C `smileIdClient` (DRC), but framework-
 * agnostic: config + fetch injected (Node, Deno, or a fake in tests).
 *
 * Signature scheme (signs outgoing requests AND verifies inbound callbacks):
 *   base64( HMAC-SHA256( `${timestamp}${partnerId}sid_request`, apiKey ) )
 */
export interface SmileIdConfig {
  baseUrl: string; // https://testapi.smileidentity.com | https://api.smileidentity.com
  partnerId: string;
  apiKey: string;
  /** Defaults for the market being verified. */
  country?: string; // e.g. 'CD'
  idType?: string; // e.g. 'VOTER_ID'
  language?: string; // e.g. 'fr'
  fetchImpl?: typeof fetch;
}

/** Approved Smile ID result codes → VERIFIED, anything else → REJECTED. */
const APPROVED_CODES = new Set(['0810', '0811', '0812']);
export function resultCodeToStatus(code: string): KycStatus {
  return APPROVED_CODES.has(code) ? 'VERIFIED' : 'REJECTED';
}

export class SmileIdProvider implements KycProvider {
  readonly id = 'smile-id';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: SmileIdConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  /** base64 HMAC-SHA256 of `${timestamp}${partnerId}sid_request`. */
  signature(timestamp: string): string {
    return createHmac('sha256', this.cfg.apiKey)
      .update(`${timestamp}${this.cfg.partnerId}sid_request`)
      .digest('base64');
  }

  private get environment(): 'sandbox' | 'production' {
    return this.cfg.baseUrl.includes('testapi') ? 'sandbox' : 'production';
  }

  async startVerification(req: StartVerificationRequest): Promise<StartVerificationResult> {
    if (!this.cfg.partnerId || !this.cfg.apiKey) throw new Error('Missing Smile ID partnerId/apiKey');
    const timestamp = new Date().toISOString();
    const jobType = req.level === 'document' ? 6 : 1;
    const jobId = `clairtus-${req.partyRef}-${Date.now()}`;
    const body = {
      partner_id: this.cfg.partnerId,
      timestamp,
      signature: this.signature(timestamp),
      user_id: req.partyRef,
      job_id: jobId,
      job_type: jobType,
      product: jobType === 1 ? 'biometric_kyc' : 'document_verification',
      callback_url: req.callbackUrl,
      country: this.cfg.country ?? 'CD',
      id_type: this.cfg.idType ?? 'VOTER_ID',
      language: this.cfg.language ?? 'fr',
    };
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
    if (!res.ok || !data.token) throw new Error(`Smile ID token error: ${data.error ?? res.status}`);
    return { token: data.token, jobId, environment: this.environment };
  }

  parseCallback(body: unknown): NormalizedKycResult | null {
    const b = body as {
      PartnerParams?: { user_id?: string }; ResultCode?: string; SmileJobID?: string; IsFinalResult?: string | boolean;
    } | null;
    const partyRef = b?.PartnerParams?.user_id;
    const resultCode = b?.ResultCode;
    if (!b || !partyRef || !resultCode) return null;
    return {
      partyRef,
      status: resultCodeToStatus(resultCode),
      resultCode,
      jobId: b.SmileJobID,
      isFinal: b.IsFinalResult === 'true' || b.IsFinalResult === true,
    };
  }

  verifyCallback(body: unknown): boolean {
    const b = body as { timestamp?: string; signature?: string } | null;
    if (!b?.timestamp || !b.signature) return false;
    return this.signature(b.timestamp) === b.signature;
  }
}
