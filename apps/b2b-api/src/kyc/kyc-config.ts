import { SmileIdProvider, type KycProvider } from '@clairtus/kyc';

export const SMILE_ID_SANDBOX_URL = 'https://testapi.smileidentity.com';
export const SMILE_ID_PROD_URL = 'https://api.smileidentity.com';

export interface SmileIdConfig {
  baseUrl: string;
  partnerId: string;
  apiKey: string;
  country?: string;
  idType?: string;
}

/**
 * Resolve Smile ID config from env, or `null` when credentials are absent (KYC stays disabled).
 * `SMILE_ID_SANDBOX=false` selects the **production** base URL — that one flag flips KYC live.
 */
export function smileIdConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmileIdConfig | null {
  const partnerId = env.SMILE_ID_PARTNER_ID;
  const apiKey = env.SMILE_ID_API_KEY;
  if (!partnerId || !apiKey) return null;
  const sandbox = env.SMILE_ID_SANDBOX !== 'false';
  return {
    baseUrl: sandbox ? SMILE_ID_SANDBOX_URL : SMILE_ID_PROD_URL,
    partnerId,
    apiKey,
    country: env.SMILE_ID_COUNTRY,
    idType: env.SMILE_ID_ID_TYPE,
  };
}

/** Build the Smile ID KYC provider from env (production when `SMILE_ID_SANDBOX=false`), or null. */
export function kycProviderFromEnv(env: NodeJS.ProcessEnv = process.env): KycProvider | null {
  const cfg = smileIdConfigFromEnv(env);
  return cfg ? new SmileIdProvider(cfg) : null;
}
