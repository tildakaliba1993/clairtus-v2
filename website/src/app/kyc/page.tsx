"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Script from "next/script";
import Image from "next/image";

type Step = "loading" | "ready" | "verifying" | "success" | "error";

const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_BOT_NUMBER ?? "243000000000";

function KYCContent() {
    const searchParams = useSearchParams();
    const phone        = searchParams.get("phone") ?? "";

    const [step, setStep]       = useState<Step>("loading");
    const [errMsg, setErrMsg]   = useState("");
    const [sdkLoaded, setSdkLoaded] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const tokenRef     = useRef<{ token: string; partner_id: string; environment: string } | null>(null);

    // Fetch the Smile ID session token from our server-side API (API key never touches the browser).
    useEffect(() => {
        if (!phone) {
            setErrMsg("Lien invalide. Revenez sur WhatsApp et recommencez.");
            setStep("error");
            return;
        }

        const clean = phone.replace(/\D/g, "");
        if (clean.length < 10 || clean.length > 15) {
            setErrMsg("Numéro de téléphone invalide dans le lien.");
            setStep("error");
            return;
        }

        fetch(`/api/kyc-init?phone=${encodeURIComponent(clean)}`)
            .then(r => r.json())
            .then(data => {
                if (data.error) throw new Error(data.error);
                tokenRef.current = data;
                setStep("ready");
            })
            .catch(err => {
                console.error("[KYC Page] Token fetch error:", err);
                setErrMsg(err.message ?? "Impossible de démarrer la vérification. Réessayez plus tard.");
                setStep("error");
            });
    }, [phone]);

    // Mount the Smile ID web SDK once the script is loaded and the token is available.
    useEffect(() => {
        if (!sdkLoaded || step !== "ready" || !tokenRef.current || !containerRef.current) return;

        const w = window as any;
        if (typeof w.SmileIdentity !== "function" && typeof w.SmileIdentityCore?.init !== "function") {
            console.error("[KYC Page] Smile ID SDK not found on window.");
            setErrMsg("Impossible de charger le module de vérification. Réactualisez la page.");
            setStep("error");
            return;
        }

        const { token, partner_id, environment } = tokenRef.current;

        // SmileIdentityCore.init mounts the verification UI into the container element.
        // Full API reference: https://docs.usesmileid.com/integration-options/web-api
        const smileInit = w.SmileIdentityCore?.init ?? w.SmileIdentity;
        smileInit({
            token,
            partner_id,
            product:           "biometric_kyc",
            environment,
            country:           "CD",        // Democratic Republic of Congo
            id_type:           "VOTER_ID",  // Carte d'électeur nationale
            language:          "fr",
            consent_required:  true,
            allow_agent_mode:  false,

            // Called when the user completes the verification flow.
            onSuccess: () => {
                setStep("success");
            },

            // Called when the user closes the widget without completing.
            onClose: () => {
                // Stay on the "ready" step so they can try again.
                setStep("ready");
            },

            // Called on SDK errors.
            onError: (err: unknown) => {
                console.error("[KYC Page] Smile ID SDK error:", err);
                setErrMsg("Une erreur est survenue lors de la vérification. Veuillez réessayer.");
                setStep("error");
            },
        });

        if (containerRef.current) {
            w.SmileIdentityCore?.mount?.(containerRef.current);
        }
    }, [sdkLoaded, step]);

    const whatsappDeepLink = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("BONJOUR")}`;

    return (
        <div className="min-h-screen bg-[#0d1b2a] text-white flex flex-col items-center px-4 py-8">
            {/* Header */}
            <div className="w-full max-w-md mb-8 flex flex-col items-center">
                <Image src="/logo-clairtus.svg" alt="Clairtus" width={160} height={40} className="h-10 w-auto mb-4" />
                <h1 className="text-xl font-bold text-center">Vérification d&apos;Identité</h1>
                <p className="text-sm text-gray-400 text-center mt-1">
                    Sécurisée par Smile ID — vos données sont chiffrées et protégées
                </p>
            </div>

            <div className="w-full max-w-md">

                {/* LOADING */}
                {step === "loading" && (
                    <div className="flex flex-col items-center gap-4 py-16">
                        <div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
                        <p className="text-gray-400 text-sm">Chargement en cours…</p>
                    </div>
                )}

                {/* READY — waiting for SDK to mount */}
                {step === "ready" && (
                    <div className="space-y-6">
                        <div className="bg-[#162231] border border-white/10 rounded-xl p-5 space-y-3">
                            <h2 className="font-semibold text-base">Ce dont vous aurez besoin :</h2>
                            <ul className="space-y-2 text-sm text-gray-300">
                                <li className="flex items-start gap-2">
                                    <span className="text-emerald-400 mt-0.5">✓</span>
                                    <span>Votre <strong>Carte d&apos;Électeur Nationale</strong> ou votre <strong>Passeport</strong></span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-emerald-400 mt-0.5">✓</span>
                                    <span>Un bon éclairage et une caméra frontale fonctionnelle</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-emerald-400 mt-0.5">✓</span>
                                    <span>Environ <strong>2 minutes</strong> sans interruption</span>
                                </li>
                            </ul>
                        </div>

                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-sm text-amber-300">
                            <p>🔐 Cette vérification est <strong>obligatoire</strong> pour les transactions supérieures à 500 USD. Vos données ne seront jamais partagées sans votre consentement.</p>
                        </div>

                        {/* The Smile ID SDK will mount its UI into this container */}
                        <div ref={containerRef} id="smile-identity-web" className="min-h-[400px] rounded-xl overflow-hidden" />
                    </div>
                )}

                {/* VERIFYING */}
                {step === "verifying" && (
                    <div className="flex flex-col items-center gap-4 py-16">
                        <div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
                        <p className="text-center text-gray-300 text-sm">
                            Vérification en cours…<br />Ne fermez pas cette page.
                        </p>
                    </div>
                )}

                {/* SUCCESS */}
                {step === "success" && (
                    <div className="flex flex-col items-center gap-6 py-8 text-center">
                        <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center">
                            <span className="text-5xl">✅</span>
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-emerald-400 mb-2">Vérification soumise !</h2>
                            <p className="text-gray-300 text-sm">
                                Vos documents ont bien été envoyés à nos systèmes de sécurité.<br />
                                Vous recevrez une <strong>notification WhatsApp</strong> dans quelques instants pour confirmer le résultat.
                            </p>
                        </div>
                        <a
                            href={whatsappDeepLink}
                            className="w-full max-w-xs bg-[#25D366] hover:bg-[#1ebe57] text-white font-semibold py-3 px-6 rounded-xl text-center transition-colors flex items-center justify-center gap-2"
                        >
                            <span>💬</span> Retour sur WhatsApp
                        </a>
                    </div>
                )}

                {/* ERROR */}
                {step === "error" && (
                    <div className="flex flex-col items-center gap-6 py-8 text-center">
                        <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center">
                            <span className="text-5xl">❌</span>
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-red-400 mb-2">Une erreur est survenue</h2>
                            <p className="text-gray-300 text-sm">{errMsg || "Veuillez réessayer ou contacter le support Clairtus."}</p>
                        </div>
                        <div className="flex flex-col gap-3 w-full max-w-xs">
                            <button
                                onClick={() => window.location.reload()}
                                className="w-full bg-white/10 hover:bg-white/20 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
                            >
                                🔄 Réessayer
                            </button>
                            <a
                                href={whatsappDeepLink}
                                className="w-full bg-[#25D366] hover:bg-[#1ebe57] text-white font-semibold py-3 px-6 rounded-xl text-center transition-colors flex items-center justify-center gap-2"
                            >
                                <span>💬</span> Contacter le support
                            </a>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <p className="mt-8 text-xs text-gray-600 text-center max-w-xs">
                La vérification d&apos;identité est assurée par Smile ID conformément aux réglementations KYC/AML en vigueur. Vos données biométriques sont traitées de manière sécurisée et ne sont pas stockées par Clairtus.
            </p>

            {/* Smile ID Web SDK — loaded last, after the page is interactive */}
            {/* Replace the src with the exact CDN URL from your Smile ID dashboard */}
            <Script
                src="https://cdn.smileidentity.com/js/v2/script.min.js"
                strategy="lazyOnload"
                onLoad={() => setSdkLoaded(true)}
                onError={() => {
                    setErrMsg("Impossible de charger le module de vérification. Vérifiez votre connexion.");
                    setStep("error");
                }}
            />
        </div>
    );
}

// useSearchParams() bails out of static prerendering, so the page must wrap it in a Suspense boundary.
export default function KYCPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-[#0d1b2a] text-white flex flex-col items-center justify-center px-4 py-8">
                <div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
                <p className="text-gray-400 text-sm mt-4">Chargement en cours…</p>
            </div>
        }>
            <KYCContent />
        </Suspense>
    );
}
