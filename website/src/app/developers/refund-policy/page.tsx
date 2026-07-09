import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Refund & Dispute Policy — Clairtus for Business (B2B)",
  description:
    "Refund, delivery and dispute policy for transactions facilitated through the Clairtus B2B platform. Funds are held and refunded by licensed payment providers.",
  alternates: { canonical: "/developers/refund-policy" },
};

const CONTACT_EMAIL = "admin@clairtus.com";
const LAST_UPDATED = "July 2026";

export default function RefundPolicyPage() {
  return (
    <main className="min-h-screen bg-[#020617] text-slate-300 py-20 px-6 sm:px-12 selection:bg-primary/30">
      <div className="max-w-3xl mx-auto bg-white/[0.02] border border-white/10 rounded-3xl p-8 sm:p-12 shadow-2xl backdrop-blur-sm">
        <h1 className="text-3xl font-bold text-white mb-2 font-heading">Refund &amp; Dispute Policy</h1>
        <p className="text-sm text-slate-400">Clairtus for Business (B2B) · South Africa</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed">
          <p>Last updated: {LAST_UPDATED}</p>

          <p>
            This policy explains how delivery, refunds, and disputes are handled for transactions facilitated through the
            Clairtus business platform, operated by <strong className="text-white">Fincrest (Pty) Ltd</strong>
            (registration number 2025/522652/07), trading as Clairtus. It should be read together with our{" "}
            <Link href="/developers/terms" className="text-primary hover:text-emerald-400">Terms of Service</Link>.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">1. Nature of the service</h2>
          <p>
            Clairtus provides B2B software that lets marketplaces embed escrow-style, milestone-based payment workflows.
            The Clairtus service itself is a digital software service delivered on a subscription / usage basis. The
            underlying goods or services purchased in any transaction are supplied by the seller on the Merchant&rsquo;s
            platform, not by Clairtus.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">2. Non-custodial handling of funds</h2>
          <p>
            <strong className="text-white">Clairtus does not hold or control transaction funds.</strong> Buyer funds are
            collected and held by a licensed payment provider (for example, Ozow in South Africa), and any refund or
            release of those funds is executed by that licensed provider on instruction. Clairtus orchestrates these
            instructions but does not itself move or refund money.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">3. Delivery / release of funds</h2>
          <p>
            In an escrow-style flow, the buyer&rsquo;s payment is held by the licensed provider and released to the
            seller when the agreed condition or milestone is met — for example, when the buyer confirms that the goods or
            services have been received as described. This confirmation is the point of &ldquo;delivery&rdquo; for the
            escrow release.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">4. Refunds</h2>
          <p>
            Where a transaction is cancelled before release, an order is not delivered, or a dispute is resolved in the
            buyer&rsquo;s favour, the held funds are refunded to the original payment method by the licensed payment
            provider. Refund timing is subject to the ordinary clearing and settlement times of the payment rail used and
            the provider&rsquo;s processes; refunds are typically initiated within a few business days of the refund
            condition being confirmed. Provider or scheme fees may apply as set out in the applicable provider terms.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">5. Raising a dispute</h2>
          <p>
            If a buyer or seller believes a transaction has not been completed as agreed, a dispute can be raised through
            the Merchant&rsquo;s platform or by contacting us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:text-emerald-400">{CONTACT_EMAIL}</a>. While a
            dispute is open, the affected funds remain held by the licensed provider until the dispute is resolved by
            agreement between the parties or in accordance with our dispute process and the provider&rsquo;s and card
            schemes&rsquo; rules.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">6. Subscription / software fees</h2>
          <p>
            Fees charged by Clairtus for access to the Services are non-refundable except where required by law or
            expressly agreed in writing. Questions about software billing can be directed to{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:text-emerald-400">{CONTACT_EMAIL}</a>.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">7. Contact</h2>
          <p>
            For any refund, delivery, or dispute query, contact{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:text-emerald-400">{CONTACT_EMAIL}</a>.
          </p>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 flex items-center justify-between text-sm">
          <Link href="/developers" className="text-primary hover:text-emerald-400 font-medium transition-colors">
            &larr; Back to Developers
          </Link>
          <Link href="/developers/terms" className="text-slate-400 hover:text-white transition-colors">
            Terms of Service &rarr;
          </Link>
        </div>
      </div>
    </main>
  );
}
