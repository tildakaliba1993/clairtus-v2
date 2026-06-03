import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { SmileIdProvider, resultCodeToStatus, type StartVerificationRequest } from '../src';

function fakeFetch(json: unknown, ok = true, status = 200) {
  const calls: { url: string; body: any }[] = [];
  const fn = (async (url: string, init?: { body?: string }) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok, status, json: async () => json } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const PARTNER = 'partner-123';
const API_KEY = 'sid_test_key';
const cfg = (fetchImpl: typeof fetch) => ({
  baseUrl: 'https://testapi.smileidentity.com',
  partnerId: PARTNER,
  apiKey: API_KEY,
  fetchImpl,
});

const expectedSig = (ts: string) =>
  createHmac('sha256', API_KEY).update(`${ts}${PARTNER}sid_request`).digest('base64');

describe('resultCodeToStatus', () => {
  it('maps approved codes to VERIFIED, others to REJECTED', () => {
    for (const c of ['0810', '0811', '0812']) expect(resultCodeToStatus(c)).toBe('VERIFIED');
    for (const c of ['0941', '1234', '']) expect(resultCodeToStatus(c)).toBe('REJECTED');
  });
});

describe('startVerification', () => {
  it('POSTs a signed token request and returns the session token', async () => {
    const { fn, calls } = fakeFetch({ token: 'tok_abc' });
    const provider = new SmileIdProvider(cfg(fn));
    const req: StartVerificationRequest = { partyRef: 'party-1', callbackUrl: 'https://api.clairtus/cb', level: 'biometric' };
    const res = await provider.startVerification(req);

    expect(calls[0]!.url).toBe('https://testapi.smileidentity.com/v1/token');
    const body = calls[0]!.body;
    expect(body).toMatchObject({
      partner_id: PARTNER, user_id: 'party-1', job_type: 1, product: 'biometric_kyc',
      callback_url: 'https://api.clairtus/cb',
    });
    expect(body.signature).toBe(expectedSig(body.timestamp)); // signature matches the sent timestamp
    expect(res).toMatchObject({ token: 'tok_abc', environment: 'sandbox' });
    expect(res.jobId).toContain('party-1');
  });

  it('uses job_type 6 (document) when level=document', async () => {
    const { fn, calls } = fakeFetch({ token: 't' });
    await new SmileIdProvider(cfg(fn)).startVerification({ partyRef: 'p', callbackUrl: 'cb', level: 'document' });
    expect(calls[0]!.body).toMatchObject({ job_type: 6, product: 'document_verification' });
  });

  it('throws when the provider returns no token', async () => {
    const { fn } = fakeFetch({ error: 'bad' }, false, 400);
    await expect(new SmileIdProvider(cfg(fn)).startVerification({ partyRef: 'p', callbackUrl: 'cb' }))
      .rejects.toThrow(/Smile ID token error/);
  });
});

describe('parseCallback', () => {
  const provider = new SmileIdProvider(cfg(fakeFetch({}).fn));
  it('normalizes a final approved callback', () => {
    const r = provider.parseCallback({ PartnerParams: { user_id: 'party-1' }, ResultCode: '0810', SmileJobID: 'job-9', IsFinalResult: 'true' });
    expect(r).toEqual({ partyRef: 'party-1', status: 'VERIFIED', resultCode: '0810', jobId: 'job-9', isFinal: true });
  });
  it('marks intermediate (non-final) results', () => {
    const r = provider.parseCallback({ PartnerParams: { user_id: 'p' }, ResultCode: '0810', IsFinalResult: 'false' });
    expect(r!.isFinal).toBe(false);
  });
  it('rejected code → REJECTED; missing fields → null', () => {
    expect(provider.parseCallback({ PartnerParams: { user_id: 'p' }, ResultCode: '0941', IsFinalResult: 'true' })!.status).toBe('REJECTED');
    expect(provider.parseCallback({ ResultCode: '0810' })).toBeNull();
    expect(provider.parseCallback(null)).toBeNull();
  });
});

describe('verifyCallback', () => {
  const provider = new SmileIdProvider(cfg(fakeFetch({}).fn));
  it('accepts a correctly signed callback', () => {
    const timestamp = '2026-06-03T00:00:00.000Z';
    expect(provider.verifyCallback({ timestamp, signature: expectedSig(timestamp) })).toBe(true);
  });
  it('rejects a bad/missing signature', () => {
    expect(provider.verifyCallback({ timestamp: '2026-06-03T00:00:00.000Z', signature: 'nope' })).toBe(false);
    expect(provider.verifyCallback({ timestamp: 'x' })).toBe(false);
    expect(provider.verifyCallback(null)).toBe(false);
  });
});
