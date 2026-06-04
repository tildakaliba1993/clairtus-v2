import { describe, it, expect } from 'vitest';
import { smileIdConfigFromEnv, kycProviderFromEnv, SMILE_ID_SANDBOX_URL, SMILE_ID_PROD_URL } from './kyc-config';

describe('Smile ID config from env (M9)', () => {
  it('returns null (KYC disabled) when credentials are absent', () => {
    expect(smileIdConfigFromEnv({})).toBeNull();
    expect(smileIdConfigFromEnv({ SMILE_ID_PARTNER_ID: 'p' })).toBeNull(); // missing api key
    expect(kycProviderFromEnv({})).toBeNull();
  });

  it('defaults to the SANDBOX base URL', () => {
    const cfg = smileIdConfigFromEnv({ SMILE_ID_PARTNER_ID: 'p', SMILE_ID_API_KEY: 'k' });
    expect(cfg?.baseUrl).toBe(SMILE_ID_SANDBOX_URL);
  });

  it('uses the PRODUCTION base URL when SMILE_ID_SANDBOX=false (one flag flips KYC live)', () => {
    const cfg = smileIdConfigFromEnv({ SMILE_ID_PARTNER_ID: 'p', SMILE_ID_API_KEY: 'k', SMILE_ID_SANDBOX: 'false' });
    expect(cfg?.baseUrl).toBe(SMILE_ID_PROD_URL);
    expect(cfg).toMatchObject({ partnerId: 'p', apiKey: 'k' });
    expect(kycProviderFromEnv({ SMILE_ID_PARTNER_ID: 'p', SMILE_ID_API_KEY: 'k', SMILE_ID_SANDBOX: 'false' })).not.toBeNull();
  });
});
