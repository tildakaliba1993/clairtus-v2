import type { ReactElement } from 'react';
import { requireKey } from '../../lib/session';
import { makeClient } from '../../lib/client';
import { KeyManager } from '../../components/KeyManager';
import type { ApiKey } from '../../lib/types';

export default async function KeysPage(): Promise<ReactElement> {
  const client = makeClient(await requireKey());
  let initialKeys: ApiKey[] = [];
  try {
    initialKeys = (await client.apiKeys.list()) as ApiKey[];
  } catch {
    // The connected key may lack keys:read — the UI still renders (create needs keys:write).
  }

  return (
    <section>
      <h1 className="font-heading mb-1 text-2xl font-bold text-foreground">API Keys</h1>
      <p className="text-muted mb-6 text-sm">
        Create, scope, and revoke keys for your integration. A new key&apos;s secret is shown <strong>once</strong>.
      </p>
      <KeyManager initialKeys={initialKeys} />
    </section>
  );
}
