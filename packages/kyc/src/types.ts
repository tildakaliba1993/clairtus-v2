/** KYC domain types — provider-agnostic, mirrors the ARCHITECTURE KycProvider plug. */

export type KycStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

/** 1 = biometric KYC (selfie + government ID), 6 = document only. */
export type KycLevel = 'biometric' | 'document';

export interface StartVerificationRequest {
  /** Our reference for the party being verified — round-trips back on the callback. */
  partyRef: string;
  /** Optional contact id (phone/email) passed to the provider. */
  contact?: string;
  level?: KycLevel;
  callbackUrl: string;
}

export interface StartVerificationResult {
  /** Session token safe to hand to the client SDK (never contains the API key). */
  token: string;
  jobId: string;
  environment: 'sandbox' | 'production';
}

/** A provider callback normalized into one shape the core understands. */
export interface NormalizedKycResult {
  partyRef: string;
  status: KycStatus;
  resultCode: string;
  jobId?: string;
  /** Providers may send intermediate callbacks; only act when final. */
  isFinal: boolean;
}

export interface KycProvider {
  readonly id: string;
  startVerification(req: StartVerificationRequest): Promise<StartVerificationResult>;
  parseCallback(body: unknown, headers?: Record<string, string>): NormalizedKycResult | null;
  verifyCallback(body: unknown, headers?: Record<string, string>): boolean;
}
