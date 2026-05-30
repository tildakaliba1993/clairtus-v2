// website/src/app/receipt/[id]/page.tsx
// Server-rendered legal receipt. Fetches transaction data using the service role key
// (server-side only) and renders a printable French-language legal document.
// URL: https://clairtus.com/receipt/{transaction-uuid}

import { notFound } from "next/navigation";
import { Metadata } from "next";
import Image from "next/image";
import { PrintButton } from "./PrintButton";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BASE_URL     = process.env.NEXT_PUBLIC_SITE_URL ?? "https://clairtus.com";

// ─── Data fetching ────────────────────────────────────────────────────────────

interface Tx {
    id: string; reference: string; item_description: string;
    base_amount: number; currency: string;
    applied_fee_percentage: number; fee_responsibility: string;
    secondary_vendor_phone: string | null; secondary_vendor_amount: number | null;
    seller_phone: string; buyer_phone: string;
    status: string; created_at: string; updated_at: string;
}
interface User { phone_number: string; first_name: string | null; last_name: string | null; }

async function fetchReceipt(id: string): Promise<{ tx: Tx; users: Record<string, User> } | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return null;
    if (!SUPABASE_URL || !SERVICE_KEY) return null;

    const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const cols = "id,reference,item_description,base_amount,currency,applied_fee_percentage,fee_responsibility,secondary_vendor_phone,secondary_vendor_amount,seller_phone,buyer_phone,status,created_at,updated_at";

    const txRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${id}&select=${cols}`, {
        headers: h, next: { revalidate: 300 }
    });
    const txArr = await txRes.json();
    const tx: Tx = txArr?.[0];
    if (!tx) return null;

    const phones = [tx.seller_phone, tx.buyer_phone, tx.secondary_vendor_phone].filter(Boolean);
    const usersRes = await fetch(
        `${SUPABASE_URL}/rest/v1/users?phone_number=in.(${phones.join(",")})&select=phone_number,first_name,last_name`,
        { headers: h, next: { revalidate: 300 } }
    );
    const usersArr: User[] = await usersRes.json();
    const users = Object.fromEntries(usersArr.map(u => [u.phone_number, u]));
    return { tx, users };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("fr-FR", {
        day: "numeric", month: "long", year: "numeric",
        hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kinshasa",
    });
}
function fmtAmount(n: number, currency: string) {
    return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
function displayName(user: User | undefined, phone: string) {
    if (user?.first_name || user?.last_name) {
        return `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() + `  (+${phone})`;
    }
    return `+${phone}`;
}
function feeRespLabel(r: string) {
    if (r === "BUYER")  return "À la charge de l'Acheteur";
    if (r === "SPLIT")  return "Partagés 50/50";
    return "À la charge du Vendeur";
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
    const { id } = await params;
    const data = await fetchReceipt(id);
    const ref  = data?.tx?.reference ?? "—";
    return {
        title: `Reçu Légal ${ref} | Clairtus`,
        description: "Reçu légal de transaction sécurisée émis par Clairtus.",
        robots: "noindex,nofollow",
    };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const data = await fetchReceipt(id);
    if (!data) notFound();

    const { tx, users } = data;

    // Show a "pending" view for non-completed transactions
    if (tx.status !== "COMPLETED") {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
                <div className="max-w-md text-center">
                    <div className="text-5xl mb-4">⏳</div>
                    <h1 className="text-xl font-bold text-gray-800 mb-2">Reçu Non Disponible</h1>
                    <p className="text-gray-500 text-sm">
                        Cette transaction ({tx.reference}) n'est pas encore finalisée.<br />
                        Le reçu légal sera disponible dès que les fonds auront été libérés.
                    </p>
                </div>
            </div>
        );
    }

    // Financial calculation
    const feePct       = tx.applied_fee_percentage ?? 1.5;
    const totalFee     = parseFloat((tx.base_amount * feePct / 100).toFixed(2));
    const feeResp      = tx.fee_responsibility || "SELLER";
    const buyerExtra   = feeResp === "BUYER" ? totalFee : feeResp === "SPLIT" ? parseFloat((totalFee / 2).toFixed(2)) : 0;
    const depositAmt   = parseFloat((tx.base_amount + buyerExtra).toFixed(2));
    const secondaryAmt = tx.secondary_vendor_phone ? (Number(tx.secondary_vendor_amount) || 0) : 0;
    const primaryNet   = parseFloat((depositAmt - totalFee - secondaryAmt).toFixed(2));
    const secondaryFee = parseFloat((secondaryAmt * feePct / 100).toFixed(2));
    const secondaryNet = parseFloat((secondaryAmt - secondaryFee).toFixed(2));

    const receiptUrl = `${BASE_URL}/receipt/${tx.id}`;
    const qrUrl      = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(receiptUrl)}&color=065f46&bgcolor=ffffff&margin=4`;

    return (
        <>
            {/* Print-only styles */}
            <style dangerouslySetInnerHTML={{ __html: `
                @media print {
                    body { background: white !important; }
                    .no-print { display: none !important; }
                    .receipt-card { box-shadow: none !important; border: 1px solid #e5e7eb !important; }
                }
            `}} />

            <div className="min-h-screen bg-gray-100 py-8 px-4">
                {/* Top action bar */}
                <div className="no-print max-w-2xl mx-auto mb-4 flex items-center justify-between">
                    <span className="text-sm text-gray-500">Reçu légal Clairtus · {tx.reference}</span>
                    <PrintButton />
                </div>

                {/* Receipt card */}
                <div className="receipt-card max-w-2xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden">

                    {/* Header */}
                    <div className="bg-gradient-to-r from-emerald-800 to-emerald-700 px-8 py-6 flex items-center justify-between">
                        <div>
                            <Image src="/logo-clairtus.svg" alt="Clairtus" width={130} height={32} className="h-8 w-auto brightness-0 invert mb-2" />
                            <p className="text-emerald-200 text-xs tracking-widest uppercase">Service d&apos;Escrow Sécurisé · RDC</p>
                        </div>
                        <div className="text-right">
                            <p className="text-white/60 text-xs uppercase tracking-wider">Émis le</p>
                            <p className="text-white text-sm font-mono">{fmtDate(tx.created_at)}</p>
                        </div>
                    </div>

                    {/* Title + status */}
                    <div className="px-8 pt-6 pb-4 flex items-start justify-between border-b border-gray-100">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">REÇU LÉGAL</h1>
                            <p className="text-sm text-gray-400 mt-0.5">de Transaction Sécurisée</p>
                        </div>
                        <div className="text-right">
                            <div className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                                Transaction Confirmée
                            </div>
                            <p className="text-xs text-gray-400 mt-1.5 font-mono">{tx.reference}</p>
                        </div>
                    </div>

                    <div className="px-8 py-6 space-y-6">

                        {/* Objet */}
                        <div>
                            <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Objet de la Transaction</h2>
                            <p className="text-gray-800 font-medium bg-gray-50 rounded-lg px-4 py-3 text-sm border border-gray-100">
                                &ldquo;{tx.item_description}&rdquo;
                            </p>
                        </div>

                        {/* Parties */}
                        <div>
                            <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Parties Impliquées</h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                                    <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 font-semibold">Vendeur / Bailleur</p>
                                    <p className="text-gray-800 text-sm font-medium font-mono">{displayName(users[tx.seller_phone], tx.seller_phone)}</p>
                                </div>
                                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                                    <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 font-semibold">Acheteur / Locataire</p>
                                    <p className="text-gray-800 text-sm font-medium font-mono">{displayName(users[tx.buyer_phone], tx.buyer_phone)}</p>
                                </div>
                                {tx.secondary_vendor_phone && (
                                    <div className="bg-blue-50 rounded-xl p-4 border border-blue-100 sm:col-span-2">
                                        <p className="text-[10px] text-blue-500 uppercase tracking-wider mb-1 font-semibold">Bénéficiaire Secondaire (Split)</p>
                                        <p className="text-gray-800 text-sm font-medium font-mono">{displayName(users[tx.secondary_vendor_phone], tx.secondary_vendor_phone)}</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Financial breakdown */}
                        <div>
                            <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Détails Financiers</h2>
                            <div className="rounded-xl border border-gray-200 overflow-hidden text-sm">
                                <div className="bg-emerald-700 text-white px-4 py-3 flex justify-between font-semibold">
                                    <span>Montant de la transaction</span>
                                    <span className="font-mono">{fmtAmount(tx.base_amount, tx.currency)}</span>
                                </div>
                                <div className="divide-y divide-gray-100">
                                    <div className="px-4 py-3 flex justify-between text-gray-600">
                                        <span>Frais d&apos;escrow Clairtus ({feePct}%)</span>
                                        <div className="text-right">
                                            <span className="font-mono text-gray-800">− {fmtAmount(totalFee, tx.currency)}</span>
                                            <span className="ml-2 text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{feeRespLabel(feeResp)}</span>
                                        </div>
                                    </div>
                                    {tx.secondary_vendor_phone && (
                                        <div className="px-4 py-3 flex justify-between text-gray-600 bg-blue-50/50">
                                            <span>Part du bénéficiaire secondaire</span>
                                            <span className="font-mono text-gray-800">{fmtAmount(secondaryNet, tx.currency)}</span>
                                        </div>
                                    )}
                                    <div className="px-4 py-3 flex justify-between font-semibold text-gray-900 bg-gray-50">
                                        <span>Net versé au vendeur principal</span>
                                        <span className="font-mono text-emerald-700">{fmtAmount(primaryNet, tx.currency)}</span>
                                    </div>
                                    <div className="px-4 py-3 flex justify-between text-gray-600">
                                        <span>Montant payé par l&apos;acheteur</span>
                                        <span className="font-mono">{fmtAmount(depositAmt, tx.currency)}</span>
                                    </div>
                                    <div className="px-4 py-3 flex justify-between text-gray-600">
                                        <span>Date de finalisation</span>
                                        <span className="font-mono text-gray-800">{fmtDate(tx.updated_at)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Certification */}
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                            <div className="flex gap-4">
                                <div className="shrink-0">
                                    {/* QR code for receipt verification */}
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={qrUrl} alt="QR code de vérification" width={90} height={90} className="rounded-lg border border-emerald-100" />
                                    <p className="text-[9px] text-emerald-600 text-center mt-1 leading-tight">Scanner pour<br/>vérifier</p>
                                </div>
                                <div className="text-xs text-emerald-800 leading-relaxed">
                                    <p className="font-bold text-sm text-emerald-900 mb-1">⚖️ Attestation Légale Clairtus</p>
                                    <p>
                                        Ce document certifie que la transaction référencée <strong>{tx.reference}</strong> a été exécutée
                                        via la plateforme d&apos;escrow sécurisé Clairtus. Les fonds ont été placés sous séquestre
                                        puis libérés après <strong>vérification par code PIN par l&apos;acheteur</strong>, confirmant
                                        la bonne réception du bien ou service.
                                    </p>
                                    <p className="mt-2">
                                        Clairtus agit en qualité de <strong>tiers de confiance neutre et certifie l&apos;authenticité</strong> de
                                        cette transaction. Ce reçu est opposable à toute contestation.
                                    </p>
                                    <p className="mt-2 text-emerald-600">
                                        Vérifiable sur : <span className="font-mono">{receiptUrl}</span>
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-[10px] text-gray-400">
                            <span>Clairtus SAS · www.clairtus.com · support@clairtus.com</span>
                            <span className="font-mono">{tx.reference}</span>
                        </div>
                    </div>
                </div>

                {/* Bottom mobile button */}
                <div className="no-print max-w-2xl mx-auto mt-4 text-center">
                    <PrintButton />
                    <p className="text-xs text-gray-400 mt-2">
                        Ce reçu est permanent et accessible via le lien ci-dessus.
                    </p>
                </div>
            </div>
        </>
    );
}
