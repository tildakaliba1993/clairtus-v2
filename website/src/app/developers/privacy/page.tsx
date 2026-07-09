import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Clairtus for Business (B2B)",
  description:
    "Privacy policy for the Clairtus B2B platform, operated by Fincrest (Pty) Ltd, in accordance with South Africa's POPIA.",
  alternates: { canonical: "/developers/privacy" },
};

const CONTACT_EMAIL = "admin@clairtus.com";
const LAST_UPDATED = "July 2026";

export default function BusinessPrivacyPage() {
  return (
    <main className="min-h-screen bg-[#020617] text-slate-300 py-20 px-6 sm:px-12 selection:bg-primary/30">
      <div className="max-w-3xl mx-auto bg-white/[0.02] border border-white/10 rounded-3xl p-8 sm:p-12 shadow-2xl backdrop-blur-sm">
        <h1 className="text-3xl font-bold text-white mb-2 font-heading">Privacy Policy</h1>
        <p className="text-sm text-slate-400">Clairtus for Business (B2B) · South Africa</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed">
          <p>Last updated: {LAST_UPDATED}</p>

          <p>
            This Privacy Policy explains how <strong className="text-white">Fincrest (Pty) Ltd</strong> (registration
            number 2025/522652/07), trading as Clairtus (&ldquo;Clairtus&rdquo;, &ldquo;we&rdquo;), processes personal
            information in connection with the Clairtus business platform (API and dashboard), in accordance with the
            Protection of Personal Information Act, 2013 (&ldquo;POPIA&rdquo;).
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">1. Information we collect</h2>
          <p>
            We collect information you provide when you register and use the Services — such as business and contact
            details, account credentials, and API usage data — and technical information (such as log and device data)
            generated when you use the platform. For transactions, we process the limited data needed to instruct a
            payment (such as amounts, references, and party identifiers).
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">2. How we use information</h2>
          <p>
            We use personal information to provide, secure, and improve the Services; to orchestrate payment
            instructions; to meet legal, regulatory, and fraud-prevention obligations; and to communicate with you about
            your account.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">3. Payment data and licensed providers</h2>
          <p>
            Clairtus does not hold or control funds. To effect a collection or payout, the information necessary to
            complete the payment is shared with the relevant <strong className="text-white">licensed payment
            provider</strong> (for example, Ozow in South Africa or PawaPay in the DRC), which processes it under its own
            privacy terms and regulatory obligations. We share personal information only as needed to provide the
            Services, to comply with law, or with your consent.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">4. Retention and security</h2>
          <p>
            We retain personal information for as long as needed to provide the Services and to meet legal and regulatory
            record-keeping requirements, and we apply reasonable technical and organisational measures to protect it.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">5. Your rights</h2>
          <p>
            Subject to applicable law, you may request access to, correction of, or deletion of your personal
            information, and may object to certain processing. To exercise these rights, contact us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:text-emerald-400">{CONTACT_EMAIL}</a>.
          </p>

          <h2 className="text-xl font-semibold text-white mt-8">6. Contact</h2>
          <p>
            For any privacy question, or to reach our information officer, email{" "}
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
