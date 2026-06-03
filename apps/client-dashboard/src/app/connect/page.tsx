import type { ReactElement } from 'react';
import { ConnectForm } from '../../components/ConnectForm';

export default function ConnectPage(): ReactElement {
  return (
    <div className="mx-auto max-w-md">
      <h1 className="font-heading text-2xl font-bold text-foreground">Connect your account</h1>
      <p className="text-muted mt-1 text-sm">
        Paste a tenant API key to view your escrows, balances, payouts and webhook deliveries.
        Use a <span className="font-mono">ck_test_…</span> key for sandbox.
      </p>
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <ConnectForm />
      </div>
    </div>
  );
}
