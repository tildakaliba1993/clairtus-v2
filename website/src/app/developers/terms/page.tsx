import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Clairtus for Business (B2B)",
  description:
    "Terms of Service for the Clairtus B2B escrow & payment-orchestration API, operated by Fincrest (Pty) Ltd. Non-custodial software; funds are held and settled by licensed payment providers.",
  alternates: { canonical: "/developers/terms" },
};

const CONTACT_EMAIL = "admin@clairtus.com";
const LAST_UPDATED = "July 2026";

export default function BusinessTermsPage() {
  return (
    <main className="min-h-screen bg-[#020617] text-slate-300 py-20 px-6 sm:px-12 selection:bg-primary/30">
      <div className="max-w-3xl mx-auto bg-white/[0.02] border border-white/10 rounded-3xl p-8 sm:p-12 shadow-2xl backdrop-blur-sm">
        <h1 className="text-3xl font-bold text-white mb-2 font-heading">Terms of Service — Business (B2B)</h1>
        <p className="text-sm text-slate-400">Clairtus API &amp; dashboard · South Africa</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed">
          <p>Last updated: {LAST_UPDATED}</p>

          <p>
            These Terms of Service (the &ldquo;Terms&rdquo;) govern access to and use of the Clairtus business
            platform — the Clairtus API, dashboard and related developer services (the &ldquo;Services&rdquo;) — by
            businesses and developers (&ldquo;you&rdquo; or the &ldquo;Merchant&rdquo;). The Services are operated by
            <strong className="text-white"> Fincrest (Pty) Ltd</strong> (registration number 2025/522652/07), trading
            as Clairtus (&ldquo;Clairtus&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). By using the Services you agree to
            these Terms.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">1. What Clairtus provides</h2>
          <p>
            Clairtus is a business-to-business <strong className="text-white">software platform</strong>. We provide an
            API and dashboard that allow online marketplaces and platforms to embed escrow-style, milestone-based
            payment workflows into their own products. Clairtus supplies only the software and payment-orchestration
            layer that instructs collections and disbursements; it does not itself provide the underlying goods or
            services transacted between a Merchant&rsquo;s buyers and sellers.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">2. Non-custodial model — funds are held by licensed providers</h2>
          <p>
            <strong className="text-white">Clairtus does not hold, receive, control, or take custody of Merchant or
            end-user funds at any time.</strong> All collection, safekeeping, and disbursement of funds is performed by
            independent, licensed payment providers — for example Ozow (Ozow (Pty) Ltd) in South Africa and PawaPay for
            our Democratic Republic of Congo consumer product. Clairtus transmits payment instructions to those licensed
            providers; the movement and holding of money is executed and controlled by them under their own regulatory
            authorisations and terms.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">3. Clairtus is a technology provider, not a financial institution</h2>
          <p>
            Clairtus is a technology company. It is not a bank, a Financial Services Provider, a money remitter, or a
            custodian of funds, and it does not provide financial, investment, legal, or tax advice. Because Clairtus
            operates solely as a software provider and never holds or controls client funds — those functions being
            performed by the licensed payment provider — regulated payment and fund-custody activity in the payment chain
            is carried out by that licensed provider and not by Clairtus.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">4. Merchant accounts and eligibility</h2>
          <p>
            To use the Services you must register for an account, be a lawfully constituted business, and provide
            accurate, complete, and current information. You are responsible for safeguarding your API keys and account
            credentials and for all activity under your account. We operate a sandbox (test) mode; live mode requires
            completion of the applicable onboarding and verification by us and by the relevant licensed payment provider.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">5. Merchant obligations and compliance</h2>
          <p>
            You are responsible for your own business, your buyers and sellers, and your compliance with all applicable
            laws — including consumer-protection, tax, data-protection, and anti-money-laundering / counter-terrorist-
            financing obligations that apply to your business. You agree to complete any Know-Your-Customer /
            Know-Your-Business checks required by us or by the licensed payment providers, to keep your information
            current, and to use the Services only for lawful transactions.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">6. How escrow-style flows work</h2>
          <p>
            When a transaction is initiated through the Services, the buyer&rsquo;s funds are collected and held by the
            licensed payment provider. Funds are released to the intended recipient (for example, a seller) when the
            agreed condition or milestone is met — such as the buyer confirming receipt — as instructed through the
            Services. Where a condition is not met, or a transaction is cancelled or disputed, funds are handled in
            accordance with our <Link href="/developers/refund-policy" className="text-primary hover:text-emerald-400">Refund &amp; Dispute Policy</Link>
            and the licensed payment provider&rsquo;s processes.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">7. Fees</h2>
          <p>
            Fees for the Services are as agreed with you at onboarding or as published for your plan. Fees charged by
            the licensed payment providers for collections, payouts, and refunds are additional and governed by those
            providers&rsquo; terms. All fees are exclusive of VAT unless stated otherwise.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">8. Acceptable use</h2>
          <p>
            You may not use the Services for any unlawful, fraudulent, or deceptive purpose; for money laundering,
            terrorist financing, sanctions evasion, or transactions with sanctioned persons; for prohibited or illegal
            goods and services; or in any way that circumvents the compliance controls of Clairtus or the licensed
            payment providers. We may suspend or terminate access, and instruct the licensed provider to freeze
            associated funds, where we reasonably suspect a breach.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">9. Disputes and chargebacks</h2>
          <p>
            Transaction disputes and chargebacks are handled in accordance with our dispute process and the rules and
            timelines of the licensed payment providers and applicable card schemes. You agree to cooperate with, and
            provide information reasonably required for, the resolution of any dispute.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">10. Disclaimers and limitation of liability</h2>
          <p>
            The Services are provided &ldquo;as is&rdquo; to the maximum extent permitted by law. Clairtus is not a party
            to the underlying commercial transaction between your buyers and sellers and does not guarantee the quality,
            safety, legality, or delivery of any goods or services. To the maximum extent permitted by law, Clairtus is
            not liable for indirect or consequential loss, and our aggregate liability is limited to the fees paid by you
            to Clairtus for the Services in the three months preceding the event giving rise to the claim.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">11. Data protection</h2>
          <p>
            We process personal information in accordance with applicable data-protection law, including the Protection
            of Personal Information Act (POPIA) in South Africa. Personal information necessary to effect a payment is
            shared with the relevant licensed payment provider to enable the transaction.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">12. Governing law</h2>
          <p>
            These Terms are governed by the laws of the Republic of South Africa, and the South African courts have
            jurisdiction, without prejudice to mandatory consumer rights that may apply.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">13. Changes and contact</h2>
          <p>
            We may update these Terms from time to time; material changes will be notified through the Services or by
            email. Questions about these Terms can be sent to{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:text-emerald-400">{CONTACT_EMAIL}</a>.
          </p>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 flex items-center justify-between text-sm">
          <Link href="/developers" className="text-primary hover:text-emerald-400 font-medium transition-colors">
            &larr; Back to Developers
          </Link>
          <Link href="/developers/refund-policy" className="text-slate-400 hover:text-white transition-colors">
            Refund &amp; Dispute Policy &rarr;
          </Link>
        </div>
      </div>
    </main>
  );
}
