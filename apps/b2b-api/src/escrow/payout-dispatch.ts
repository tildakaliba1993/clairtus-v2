import { RailRouter, type PaymentRail } from '@clairtus/payments';

/** Per-mode payout routers: live keys disburse through live rails, test keys through the simulated rail. */
export interface PayoutRouters {
  live: RailRouter;
  sandbox: RailRouter;
}

/** Durable queue name for retrying a payout whose rails were all unavailable at request time. */
export const PAYOUT_DISPATCH_QUEUE = 'payout.dispatch';

export interface PayoutDispatchJob {
  payoutId: string;
  tenantId: string;
  escrowId: string;
  recipientPartyId: string;
  amount: number;
  currency: string;
  country: string;
}

/** Build the live + sandbox routers from the configured rails (each registers what's available). */
export function buildPayoutRouters(live: PaymentRail | null, sandbox: PaymentRail | null): PayoutRouters {
  const liveRouter = new RailRouter();
  if (live) liveRouter.register(live);
  const sandboxRouter = new RailRouter();
  if (sandbox) sandboxRouter.register(sandbox);
  return { live: liveRouter, sandbox: sandboxRouter };
}
