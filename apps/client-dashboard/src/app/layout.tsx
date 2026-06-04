import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Geist_Mono, Red_Hat_Display } from 'next/font/google';
import Link from 'next/link';
import './globals.css';
import { getKey } from '../lib/session';
import { modeFromKey } from '../lib/format';
import { ModeBadge } from '../components/ModeBadge';

const redHat = Red_Hat_Display({ variable: '--font-red-hat-display', subsets: ['latin'], weight: ['400', '500', '600', '700', '800'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Clairtus Dashboard',
  description: 'Manage your escrows, balances, payouts and webhooks.',
};

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/escrows', label: 'Escrows' },
  { href: '/payouts', label: 'Payouts' },
  { href: '/webhooks', label: 'Webhooks' },
  { href: '/keys', label: 'API Keys' },
];

export default async function RootLayout({ children }: { children: ReactNode }) {
  const key = await getKey();
  const mode = key ? modeFromKey(key) : null;

  return (
    <html lang="en" className={`${redHat.variable} ${geistMono.variable}`}>
      <body>
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-heading text-lg font-extrabold text-foreground">
              clair<span className="text-primary">tus</span>
            </Link>
            {key && (
              <nav className="hidden gap-5 text-sm font-medium text-muted sm:flex">
                {NAV.map((n) => (
                  <Link key={n.href} href={n.href} className="hover:text-foreground">{n.label}</Link>
                ))}
              </nav>
            )}
            <div className="flex items-center gap-3">
              {mode && <ModeBadge mode={mode} />}
              {key && (
                <form action="/api/disconnect" method="post">
                  <button className="text-sm text-muted hover:text-foreground">Disconnect</button>
                </form>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
