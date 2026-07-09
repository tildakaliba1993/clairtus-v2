import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRightLeft,
  BookOpen,
  CircleDollarSign,
  Code2,
  GitBranch,
  Layers,
  Lock,
  PlugZap,
  ScrollText,
  ShieldCheck,
  Webhook,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Clairtus for Developers | Escrow & Payout Infrastructure for Africa",
  description:
    "Non-custodial escrow and payout APIs for African marketplaces and platforms. Hold buyer funds in escrow and release on delivery across mobile money and bank rails — your funds are held and settled by licensed payment partners, never by us.",
  alternates: { canonical: "/developers" },
  openGraph: {
    title: "Clairtus for Developers | Escrow & Payout Infrastructure for Africa",
    description:
      "Non-custodial escrow and payout APIs for African marketplaces. Hold buyer funds in escrow and release on delivery across mobile money and bank rails.",
    url: "https://clairtus.com/developers",
    siteName: "Clairtus",
    locale: "en_US",
    type: "website",
  },
};

const API_BASE_URL = "https://api.clairtus.com";
const API_DOCS_URL = `${API_BASE_URL}/docs`;
const CONTACT_EMAIL = "mailto:admin@clairtus.com?subject=Clairtus%20API%20access";

const glassCard =
  "rounded-2xl border border-white/5 bg-white/[0.02] p-6 transition-colors duration-300 hover:border-primary/30 hover:bg-white/[0.04]";

const FEATURES: { icon: typeof ShieldCheck; title: string; body: string }[] = [
  {
    icon: ArrowRightLeft,
    title: "Full escrow lifecycle API",
    body: "Create, fund, release, refund and dispute escrows through a clean REST API. Single-payment or split payouts to multiple recipients, with configurable platform fees.",
  },
  {
    icon: Lock,
    title: "Non-custodial by design",
    body: "We never take possession of your customers' money. Clairtus orchestrates the flow; regulated payment partners hold and settle the funds — so you launch without your own money-services licence.",
  },
  {
    icon: PlugZap,
    title: "Multi-rail routing & failover",
    body: "One integration, many rails. We route collections and payouts across mobile money and bank partners (Korapay, PawaPay and more) with automatic failover and a circuit breaker.",
  },
  {
    icon: ScrollText,
    title: "Double-entry ledger & reconciliation",
    body: "Every movement is recorded in an immutable, balanced ledger and reconciled against partner balances (available + pending) so your books never silently drift.",
  },
  {
    icon: ShieldCheck,
    title: "Compliance & KYC built in",
    body: "Per-market amount and volume limits, structuring checks, and identity verification (Smile ID) are wired into the escrow flow — not bolted on afterwards.",
  },
  {
    icon: Webhook,
    title: "Webhooks, idempotency & retries",
    body: "Signed webhooks for every state change, mandatory idempotency keys on money operations, and a durable retry queue with a dead-letter backstop.",
  },
];

const STEPS: { icon: typeof Layers; step: string; title: string; body: string }[] = [
  {
    icon: Layers,
    step: "01",
    title: "Create an escrow",
    body: "Define the buyer, seller(s), amount, currency and fee split. Clairtus returns an escrow you can track through its whole lifecycle.",
  },
  {
    icon: CircleDollarSign,
    step: "02",
    title: "Collect the funds",
    body: "The buyer pays in via mobile money or bank transfer through a licensed partner. The funds are held — not by Clairtus, by the partner — until the deal is done.",
  },
  {
    icon: GitBranch,
    step: "03",
    title: "Release or refund",
    body: "On delivery confirmation, release to the seller; otherwise refund the buyer. Clairtus routes the payout and posts the settled, net-of-fees amounts to the ledger.",
  },
];

const DEV_POINTS = [
  "Typed SDK with auto-idempotency on money POSTs",
  "Sandbox mode — build and test with zero real money",
  "OpenAPI / Swagger reference for every endpoint",
  "Cursor-paginated list endpoints",
  "Scoped API keys (test + live) per tenant",
  "Per-key rate limiting and a single error envelope",
];

export default function DevelopersPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#020617] text-slate-50 antialiased">
      {/* —— Header —— */}
      <header className="fixed top-0 z-50 w-full border-b border-white/10 bg-[#020617]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <Link href="/" aria-label="Clairtus home" className="transition-opacity hover:opacity-80">
            <Image src="/logo-clairtus.svg" alt="Clairtus" width={140} height={28} className="h-[42px] w-[110px]" priority />
          </Link>
          <nav className="flex items-center gap-3 sm:gap-5">
            <Link href="/" className="hidden text-sm font-medium text-white/70 transition-colors hover:text-white sm:block">
              Consumer app
            </Link>
            <a href={API_DOCS_URL} className="hidden text-sm font-medium text-white/70 transition-colors hover:text-white sm:block">
              API reference
            </a>
            <a
              href={CONTACT_EMAIL}
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold font-heading text-primary-foreground shadow-lg shadow-primary/25 transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              Request API access
            </a>
          </nav>
        </div>
      </header>

      <main>
        {/* —— Hero —— */}
        <section className="relative flex flex-col justify-center px-4 pb-16 pt-32 sm:pt-40">
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            <div className="absolute left-1/2 top-[12%] h-[min(70vw,520px)] w-[min(120vw,960px)] -translate-x-1/2 rounded-full bg-[hsl(var(--primary)/0.18)] blur-[110px]" />
            <div className="absolute bottom-[8%] right-[-10%] h-[380px] w-[380px] rounded-full bg-[hsl(var(--primary)/0.10)] blur-[90px]" />
          </div>

          <div className="relative mx-auto grid w-full max-w-7xl items-center gap-12 lg:grid-cols-2">
            <div className="text-center lg:text-left">
              <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm font-semibold text-primary backdrop-blur-md">
                <Code2 size={15} strokeWidth={2} aria-hidden /> Clairtus for Developers
              </p>
              <h1 className="mt-8 text-[clamp(2rem,6vw,3.6rem)] font-bold font-heading leading-[1.07] tracking-tight text-white">
                Escrow &amp; payout infrastructure for African marketplaces.
              </h1>
              <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-white/[0.68] sm:text-xl lg:mx-0">
                A single API to hold buyer funds in escrow and release them on delivery — across mobile money and bank
                rails. <span className="text-white">Non-custodial:</span> we orchestrate the money, licensed partners
                hold and settle it.
              </p>
              <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row lg:justify-start">
                <a
                  href={CONTACT_EMAIL}
                  className="inline-flex min-h-[52px] min-w-[220px] items-center justify-center rounded-full bg-primary px-10 text-base font-semibold font-heading text-primary-foreground shadow-[0_0_52px_-8px_hsl(var(--primary)/0.85)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  Request API access
                </a>
                <a
                  href={API_DOCS_URL}
                  className="inline-flex min-h-[52px] min-w-[200px] items-center justify-center gap-2 rounded-full border border-white/20 bg-white/5 px-8 text-base font-semibold text-white backdrop-blur-md transition-colors hover:border-white/35 hover:bg-white/10"
                >
                  <BookOpen size={18} strokeWidth={1.9} aria-hidden /> Read the API docs
                </a>
              </div>
            </div>

            {/* Code snippet card */}
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1222] shadow-2xl shadow-primary/10">
              <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-3">
                <span className="h-3 w-3 rounded-full bg-rose-400/70" />
                <span className="h-3 w-3 rounded-full bg-amber-400/70" />
                <span className="h-3 w-3 rounded-full bg-emerald-400/70" />
                <span className="ml-3 font-mono text-xs text-white/50">create-escrow.sh</span>
              </div>
              <pre className="overflow-x-auto px-5 py-5 font-mono text-[12.5px] leading-relaxed text-slate-200">
                <code>{`curl ${API_BASE_URL}/v1/escrows \\
  -H "Authorization: Bearer ck_live_…" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d currency=ZAR \\
  -d baseAmount=100000 \\
  -d feeBps=150 \\
  -d sellerPartyId=pty_…

`}<span className="text-primary">{`# → escrow created. Fund it via a pay-in,
# then release to the seller on delivery.`}</span></code>
              </pre>
            </div>
          </div>

          {/* trust strip */}
          <div className="relative mx-auto mt-16 flex max-w-5xl flex-wrap items-center justify-center gap-x-6 gap-y-3 text-center text-sm font-medium text-white/55">
            <span className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5">Non-custodial</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5">Licensed-partner settlement</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5">Mobile money + bank rails</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5">Built for Africa</span>
          </div>
        </section>

        {/* —— Features —— */}
        <section className="border-t border-white/10 px-4 py-24" aria-labelledby="features-heading">
          <div className="mx-auto max-w-7xl">
            <h2 id="features-heading" className="mx-auto max-w-3xl text-center text-[clamp(1.75rem,4vw,2.5rem)] font-bold font-heading leading-tight tracking-tight text-white">
              The trust layer for online commerce in Africa
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-white/65">
              Everything you need to take payment, hold it safely, and pay it out — without becoming a payments company
              yourself.
            </p>
            <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <article key={title} className={glassCard}>
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                    <Icon size={24} strokeWidth={1.75} aria-hidden />
                  </div>
                  <h3 className="text-lg font-semibold font-heading leading-snug text-white">{title}</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-white/[0.72]">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* —— How it works —— */}
        <section className="relative border-t border-white/10 px-4 py-24" aria-labelledby="how-heading">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.12),transparent)]" aria-hidden />
          <div className="relative mx-auto max-w-7xl">
            <h2 id="how-heading" className="mx-auto max-w-3xl text-center text-[clamp(1.75rem,4vw,2.35rem)] font-bold font-heading leading-tight tracking-tight text-white">
              How an escrow flows
            </h2>
            <div className="mt-16 grid gap-8 md:grid-cols-3">
              {STEPS.map(({ icon: Icon, step, title, body }) => (
                <div key={step} className={`${glassCard} relative`}>
                  <span className="absolute right-5 top-5 font-mono text-sm text-white/25">{step}</span>
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                    <Icon size={24} strokeWidth={1.75} aria-hidden />
                  </div>
                  <h3 className="text-lg font-semibold font-heading leading-snug text-white">{title}</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-white/[0.72]">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* —— Built for developers —— */}
        <section className="border-t border-white/10 px-4 py-24" aria-labelledby="dev-heading">
          <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2">
            <div>
              <h2 id="dev-heading" className="text-[clamp(1.75rem,4vw,2.5rem)] font-bold font-heading leading-tight tracking-tight text-white">
                Built for engineers, safe for money
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/[0.68]">
                Clean primitives, predictable money semantics, and a sandbox so you can ship escrow into your product in
                days — not quarters.
              </p>
              <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                {DEV_POINTS.map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-[15px] text-white/[0.78]">
                    <span className="mt-0.5 text-primary" aria-hidden>✓</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-10 flex flex-wrap gap-4">
                <a href={API_DOCS_URL} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-primary px-7 text-base font-semibold font-heading text-primary-foreground transition-transform hover:scale-[1.02] active:scale-[0.98]">
                  <BookOpen size={18} strokeWidth={1.9} aria-hidden /> API reference
                </a>
                <a href={CONTACT_EMAIL} className="inline-flex min-h-[48px] items-center justify-center rounded-full border border-white/20 bg-white/5 px-7 text-base font-semibold text-white transition-colors hover:border-white/35 hover:bg-white/10">
                  Talk to us
                </a>
              </div>
            </div>

            {/* live-proof card */}
            <div className={`${glassCard} bg-white/[0.03]`}>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <span className="h-2 w-2 rounded-full bg-primary" aria-hidden /> Live in production
              </div>
              <h3 className="text-xl font-semibold font-heading text-white">Proven on real transactions</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-white/[0.72]">
                Our consumer product in the Democratic Republic of Congo — a WhatsApp-based escrow app on M-Pesa, Orange
                Money and Airtel Money — runs on this exact engine. The B2B API is the same escrow core, exposed for
                marketplaces and platforms to build on.
              </p>
              <Link href="/" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-opacity hover:opacity-80">
                See the consumer product <ArrowRightLeft size={15} strokeWidth={2} aria-hidden />
              </Link>
              <div className="mt-8 grid grid-cols-3 gap-4 border-t border-white/10 pt-6 text-center">
                <div>
                  <div className="text-2xl font-bold text-white">DRC</div>
                  <div className="mt-1 text-xs text-white/55">Live today</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">SA</div>
                  <div className="mt-1 text-xs text-white/55">Onboarding</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">NG</div>
                  <div className="mt-1 text-xs text-white/55">Next</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* —— Final CTA —— */}
        <section className="relative px-4 py-28" aria-labelledby="cta-heading">
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div className="absolute left-1/2 top-1/2 h-[400px] w-[min(100%,720px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[hsl(var(--primary)/0.16)] blur-[100px]" />
          </div>
          <div className="relative mx-auto max-w-3xl text-center">
            <h2 id="cta-heading" className="text-[clamp(1.85rem,4.2vw,2.75rem)] font-bold font-heading leading-tight tracking-tight text-white">
              Build escrow into your product
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/[0.68]">
              Tell us what you&apos;re building and we&apos;ll set you up with sandbox keys and a direct line to the team.
            </p>
            <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <a href={CONTACT_EMAIL} className="inline-flex min-h-[56px] min-w-[min(100%,280px)] items-center justify-center rounded-full bg-primary px-12 text-lg font-semibold font-heading text-primary-foreground shadow-[0_0_60px_-10px_hsl(var(--primary)/0.9)] transition-transform hover:scale-[1.03] active:scale-[0.98]">
                Request API access
              </a>
              <a href={API_DOCS_URL} className="inline-flex min-h-[56px] min-w-[min(100%,200px)] items-center justify-center gap-2 rounded-full border border-white/20 bg-white/5 px-8 text-lg font-semibold text-white transition-colors hover:border-white/35 hover:bg-white/10">
                <BookOpen size={20} strokeWidth={1.9} aria-hidden /> API docs
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-black/40 py-14 text-center backdrop-blur-sm">
        <p className="mx-auto max-w-2xl px-4 text-sm leading-relaxed text-slate-400">
          Clairtus — non-custodial escrow &amp; payout infrastructure for the African digital economy. Funds are held and
          settled by licensed payment partners.
        </p>
        <p className="mt-3 text-xs text-slate-500">© 2026 Clairtus. All rights reserved.</p>
        <div className="mt-6 flex items-center justify-center gap-6 text-sm text-slate-400">
          <Link href="/" className="transition-colors duration-200 hover:text-white">Consumer app</Link>
          <span className="text-white/20">|</span>
          <a href={API_DOCS_URL} className="transition-colors duration-200 hover:text-white">API reference</a>
          <span className="text-white/20">|</span>
          <Link href="/developers/terms" className="transition-colors duration-200 hover:text-white">Terms</Link>
          <span className="text-white/20">|</span>
          <Link href="/developers/refund-policy" className="transition-colors duration-200 hover:text-white">Refunds</Link>
          <span className="text-white/20">|</span>
          <Link href="/privacy" className="transition-colors duration-200 hover:text-white">Privacy</Link>
        </div>
      </footer>
    </div>
  );
}
