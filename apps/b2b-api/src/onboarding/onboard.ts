import { Tenancy } from '@clairtus/tenancy';
import { WebhookService } from '../webhooks/webhook.service';

/** Per-partner onboarding configuration (see docs/ONBOARDING.md). */
export interface PartnerConfig {
  name: string;
  /** ISO-2 market, e.g. 'ZA'. */
  country: string;
  /** Optional webhook endpoint to register up front. */
  webhookUrl?: string;
  /** API-key scopes; defaults to the standard escrow/payout/KYC set. */
  scopes?: string[];
}

export interface OnboardResult {
  tenantId: string;
  /** Sandbox key (ck_test_…) — hand to the partner to integrate against the simulated rail. */
  testKey: string;
  /** Production key (ck_live_…) — release only after sandbox sign-off + go-live checklist. */
  liveKey: string;
  webhook?: { id: string; signingSecret: string };
}

const DEFAULT_SCOPES = ['escrows:write', 'payouts:write', 'kyc:write'];

/**
 * One-call manual onboarding: create a tenant, issue test + live API keys, and (optionally)
 * register a webhook endpoint. Returns the secrets to share with the partner. Composes the
 * existing tenancy + webhook services so it stays consistent with the live system.
 */
export async function onboardTenant(
  deps: { tenancy: Tenancy; webhooks: WebhookService },
  cfg: PartnerConfig,
): Promise<OnboardResult> {
  const tenant = await deps.tenancy.createTenant({ name: cfg.name, country: cfg.country });
  const scopes = cfg.scopes ?? DEFAULT_SCOPES;
  const testKey = await deps.tenancy.issueApiKey({ tenantId: tenant.id, mode: 'test', scopes });
  const liveKey = await deps.tenancy.issueApiKey({ tenantId: tenant.id, mode: 'live', scopes });

  let webhook: OnboardResult['webhook'];
  if (cfg.webhookUrl) {
    const w = await deps.webhooks.registerEndpoint(tenant.id, cfg.webhookUrl);
    webhook = { id: w.id, signingSecret: w.signingSecret };
  }

  return { tenantId: tenant.id, testKey: testKey.plaintext, liveKey: liveKey.plaintext, webhook };
}
