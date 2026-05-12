"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import Image from "next/image";
import {
  ArrowRightLeft,
  Fingerprint,
  LockKeyhole,
  Scale,
  ShieldCheck,
  Terminal,
  Zap,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import content from "@/locales/fr.json";
import { getWhatsAppBotUrl } from "@/lib/marketing-links";

const FEATURE_ICONS: LucideIcon[] = [
  ShieldCheck,
  Zap,
  Fingerprint,
  Scale,
];
const PROGRAM_ICONS: LucideIcon[] = [Terminal, LockKeyhole, ArrowRightLeft];
type DemoView = "vendeur" | "acheteur";
type ChatMessage = {
  sender: "user" | "bot";
  delay: number;
  text: string;
};
const MIN_TYPING_LEAD_MS = 130;
const MAX_TYPING_LEAD_MS = 880;

function estimateTypingLeadMs(text: string): number {
  const compactText = text.replace(/\s+/g, " ").trim();
  const readingUnits = compactText.length * 8;
  const punctuationBonus = (compactText.match(/[.,:;!?]/g) ?? []).length * 14;
  const emojiBonus = (compactText.match(/[🔐✅🎉👏🥳💡⚠️👋]/g) ?? []).length * 24;
  const estimate = 90 + readingUnits + punctuationBonus + emojiBonus;
  return Math.max(MIN_TYPING_LEAD_MS, Math.min(MAX_TYPING_LEAD_MS, estimate));
}
const VENDEUR_CONVERSATION: ChatMessage[] = [
  { sender: "user", delay: 0.5, text: "BONJOUR" },
  {
    sender: "bot",
    delay: 1.5,
    text:
      "👋 Bonjour et bienvenue chez Clairtus.\n\nClairtus sécurise vos transactions entre acheteur et vendeur :\n• l'acheteur paie en sécurité\n• le vendeur est payé après confirmation\n• tout est tracé pour protéger les deux parties\n\nQue souhaitez-vous faire aujourd'hui ?\n[ VENDRE ]  [ ACHETER ]",
  },
  { sender: "user", delay: 3, text: "VENDRE" },
  {
    sender: "bot",
    delay: 4,
    text: "Parfait ✅\n\nDécrivez brièvement ce que vous vendez.\nExemple : MacBook Air M1 2020",
  },
  { sender: "user", delay: 5.2, text: "Smartphone Samsung A54 neuf" },
  {
    sender: "bot",
    delay: 6.3,
    text: "Super 👍\n\nQuel est le prix en $ ?\nRépondez uniquement avec un nombre.\nExemple : 900\n\n💡 Clairtus déduit 2,5% du montant total.",
  },
  { sender: "user", delay: 7.4, text: "120" },
  {
    sender: "bot",
    delay: 8.5,
    text:
      "Parfait.\n\nEnvoyez maintenant le numéro de l'acheteur en format international.\nExemple : +243...\n\nLe numéro doit appartenir à la contrepartie et être valide pour Mobile Money.\nOpérateurs supportés : M-Pesa, Orange Money, Airtel Money.",
  },
  { sender: "user", delay: 9.8, text: "+243 81 000 0000" },
  {
    sender: "bot",
    delay: 10.8,
    text: "✅ Merci.\n\nNous lançons votre transaction sécurisée.",
  },
  {
    sender: "bot",
    delay: 12,
    text:
      "✅ La contrepartie a accepté.\n\nNous attendons maintenant la confirmation du paiement Mobile Money.",
  },
  {
    sender: "bot",
    delay: 13.6,
    text:
      "✅ Fonds sécurisés.\n\nLe client a bloqué 120.00 USD.\n\nLivrez la commande, puis demandez le code PIN client et envoyez-le ici pour être payé.",
  },
  { sender: "user", delay: 15, text: "4829" },
  {
    sender: "bot",
    delay: 16.1,
    text: "🔐 Code PIN reçu.\n\nVérification en cours.",
  },
  {
    sender: "bot",
    delay: 17.3,
    text: "🎉 Paiement confirmé.\n\nCode PIN validé.\nVos fonds (117.00 USD) sont en route vers votre compte Mobile Money.",
  },
  {
    sender: "bot",
    delay: 18.4,
    text:
      "👏 Félicitations pour la vente de Smartphone Samsung A54 neuf.\n\nContinuez à vendre avec Clairtus pour des transactions toujours sécurisées.",
  },
];
const ACHETEUR_CONVERSATION: ChatMessage[] = [
  { sender: "user", delay: 0.5, text: "BONJOUR" },
  {
    sender: "bot",
    delay: 1.5,
    text:
      "👋 Bonjour et bienvenue chez Clairtus.\n\nClairtus sécurise vos transactions entre acheteur et vendeur :\n• l'acheteur paie en sécurité\n• le vendeur est payé après confirmation\n• tout est tracé pour protéger les deux parties\n\nQue souhaitez-vous faire aujourd'hui ?\n[ VENDRE ]  [ ACHETER ]",
  },
  { sender: "user", delay: 3, text: "ACHETER" },
  {
    sender: "bot",
    delay: 4,
    text: "Parfait ✅\n\nDécrivez brièvement ce que vous achetez.\nExemple : MacBook Air M1 2020",
  },
  { sender: "user", delay: 5.2, text: "Smartphone Samsung A54 neuf" },
  {
    sender: "bot",
    delay: 6.3,
    text:
      "Super 👍\n\nQuel est le prix en $ ?\nRépondez uniquement avec un nombre.\nExemple : 900\n\n💡 En tant qu'acheteur, vous payez les frais Mobile Money opérateur.",
  },
  { sender: "user", delay: 7.4, text: "120" },
  {
    sender: "bot",
    delay: 8.5,
    text:
      "Parfait.\n\nEnvoyez maintenant le numéro du vendeur en format international.\nExemple : +243...\n\nLe numéro doit appartenir à la contrepartie et être valide pour Mobile Money.\nOpérateurs supportés : M-Pesa, Orange Money, Airtel Money.",
  },
  { sender: "user", delay: 9.8, text: "+243 89 000 0000" },
  {
    sender: "bot",
    delay: 10.8,
    text: "✅ Merci.\n\nNous lançons votre transaction sécurisée.",
  },
  {
    sender: "bot",
    delay: 12,
    text:
      "✅ Confirmation enregistrée.\n\nOuvrez ce lien pour sécuriser le paiement :\nhttps://pay.clairtus.app/checkout/txn-demo\n\n💡 Les frais Mobile Money opérateur restent à la charge de l'acheteur.",
  },
  {
    sender: "bot",
    delay: 13.6,
    text:
      "🔐 Paiement sécurisé.\n\nVoici votre code PIN de livraison : 4829\n\n⚠️ Ne partagez jamais ce code par téléphone.\nNe le donnez qu'au moment où vous recevez l'article.",
  },
  {
    sender: "bot",
    delay: 16,
    text: "✅ Transaction terminée.\n\nLe vendeur a reçu son paiement.",
  },
  {
    sender: "bot",
    delay: 17.2,
    text:
      "🥳 Félicitations pour votre achat de Smartphone Samsung A54 neuf.\n\nContinuez à acheter avec Clairtus en toute confiance.",
  },
];

const viewportOnce = { once: true as const, margin: "-12% 0px -12% 0px", amount: 0.25 };

const glassCardClass =
  "bg-white/[0.02] border border-white/5 rounded-2xl p-6 hover:bg-white/[0.04] hover:border-primary/30 transition-all duration-300 backdrop-blur-sm";
const pageGutterClass = "px-2 sm:px-4 lg:px-6";
const pageMaxWidthClass = "max-w-7xl";

export default function Home() {
  const prefersReducedMotion = useReducedMotion();
  const transition = useMemo(
    () =>
      prefersReducedMotion
        ? { duration: 0.01 }
        : { duration: 0.55, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
    [prefersReducedMotion],
  );

  const staggerContainer = useMemo(
    () => ({
      hidden: {},
      visible: {
        transition: {
          staggerChildren: prefersReducedMotion ? 0 : 0.15,
          delayChildren: prefersReducedMotion ? 0 : 0,
        },
      },
    }),
    [prefersReducedMotion],
  );

  const staggerItem = useMemo(
    () =>
      prefersReducedMotion
        ? {
            hidden: { opacity: 1, y: 0 },
            visible: {
              opacity: 1,
              y: 0,
              transition: { duration: 0.01 },
            },
          }
        : {
            hidden: { opacity: 0, y: 28 },
            visible: {
              opacity: 1,
              y: 0,
              transition,
            },
          },
    [prefersReducedMotion, transition],
  );

  const whatsappBotUrl = getWhatsAppBotUrl();

  const blobTransition = prefersReducedMotion
    ? { duration: 0 }
    : {
        duration: 8,
        repeat: Infinity,
        ease: "easeInOut" as const,
      };

  const blobAnimate = prefersReducedMotion
    ? undefined
    : {
        scale: [1, 1.05, 1],
        opacity: [0.3, 0.5, 0.3],
      };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#020617] text-slate-50 antialiased">
      <a
        href="#contenu-principal"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Aller au contenu
      </a>

      <header className="fixed top-0 z-50 w-full border-b border-white/10 bg-[#020617]/80 backdrop-blur-xl">
        <div className={`mx-auto flex h-16 ${pageMaxWidthClass} items-center justify-between px-2`}>
          <Image
            src="/logo-clairtus.svg"
            alt="Clairtus"
            width={140}
            height={28}
            className="h-[42px] w-[110px]"
            priority
          />
          <a
            href={whatsappBotUrl}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold font-heading text-primary-foreground shadow-lg shadow-primary/25 transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            {content.nav.apply}
          </a>
        </div>
      </header>

      <main id="contenu-principal">
        {/* —— Hero —— */}
        <section
          className={`relative flex min-h-[min(100dvh,920px)] flex-col justify-center ${pageGutterClass} pb-8 pt-28`}
          aria-labelledby="hero-title"
        >
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <motion.div
              className="absolute left-1/2 top-[18%] h-[min(70vw,560px)] w-[min(120vw,980px)] -translate-x-1/2 rounded-full bg-[hsl(var(--primary)/0.22)] blur-[100px]"
              aria-hidden
              animate={blobAnimate}
              transition={blobTransition}
            />
            <motion.div
              className="absolute bottom-[5%] right-[-10%] h-[420px] w-[420px] rounded-full bg-[hsl(var(--primary)/0.12)] blur-[90px]"
              aria-hidden
              animate={blobAnimate}
              transition={{ ...blobTransition, delay: prefersReducedMotion ? 0 : 1.6 }}
            />
            <motion.div
              className="absolute left-[-15%] top-[40%] h-[320px] w-[320px] rounded-full bg-emerald-400/10 blur-[80px]"
              aria-hidden
              animate={blobAnimate}
              transition={{ ...blobTransition, delay: prefersReducedMotion ? 0 : 3.2 }}
            />
          </div>

          <div className={`relative mx-auto w-full ${pageMaxWidthClass}`}>
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div className="text-center lg:text-left">
                <motion.div
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 28 }}
                  animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
                  transition={transition}
                >
                  <p className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm font-semibold text-primary backdrop-blur-md">
                    {content.hero.badge}
                  </p>
                </motion.div>

                <motion.h1
                  id="hero-title"
                  className="mt-8 text-[clamp(2rem,6vw,3.75rem)] font-bold font-heading leading-[1.07] tracking-tight text-white"
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 32 }}
                  animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
                  transition={{ ...transition, delay: prefersReducedMotion ? 0 : 0.06 }}
                >
                  {content.hero.title}
                </motion.h1>

                <motion.p
                  className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-white/[0.68] sm:text-xl lg:mx-0"
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
                  animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
                  transition={{ ...transition, delay: prefersReducedMotion ? 0 : 0.12 }}
                >
                  {content.hero.subtitle}
                </motion.p>

                <motion.div
                  className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row lg:justify-start"
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
                  animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
                  transition={{ ...transition, delay: prefersReducedMotion ? 0 : 0.18 }}
                >
                  <a
                    href={whatsappBotUrl}
                    className="inline-flex min-h-[52px] min-w-[220px] items-center justify-center rounded-full bg-primary px-10 text-base font-semibold font-heading text-primary-foreground shadow-[0_0_52px_-8px_hsl(var(--primary)/0.85)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
                  >
                    {content.hero.primaryCta}
                  </a>
                  <a
                    href="#etapes"
                    className="inline-flex min-h-[52px] min-w-[220px] items-center justify-center rounded-full border border-white/20 bg-white/5 px-10 text-base font-semibold text-white backdrop-blur-md transition-colors hover:border-white/35 hover:bg-white/10"
                  >
                    {content.hero.secondaryCta}
                  </a>
                </motion.div>
              </div>
              <motion.div
                className="text-left"
                initial={prefersReducedMotion ? false : { opacity: 0, y: 32 }}
                animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
                transition={{ ...transition, delay: prefersReducedMotion ? 0 : 0.22 }}
              >
                <InteractiveChatDemo prefersReducedMotion={!!prefersReducedMotion} />
              </motion.div>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center pt-10 pb-20 opacity-70">
            <p className="mb-6 px-2 text-center text-sm font-semibold text-gray-300 sm:px-4">
              Vos fonds sont sécurisés par des partenaires de confiance en RDC
            </p>
            <div className="flex w-full max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-3 px-2 pt-20 sm:gap-x-6 sm:gap-y-4 md:gap-8">
              <div className="group flex h-14 w-[150px] items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-white/[0.08] sm:h-16 sm:w-[180px]">
                <Image
                  src="/logos/airtel.svg"
                  alt="Airtel Money"
                  width={140}
                  height={40}
                  className="h-6 w-auto object-contain transition-transform duration-300 group-hover:scale-105 sm:h-7"
                />
              </div>
              <div className="group flex h-14 w-[150px] items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-white/[0.08] sm:h-16 sm:w-[180px]">
                <Image
                  src="/logos/orange.svg"
                  alt="Orange Money"
                  width={48}
                  height={48}
                  className="h-7 w-auto object-contain transition-transform duration-300 group-hover:scale-105 sm:h-8"
                />
              </div>
              <div className="group flex h-14 w-[150px] items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-white/[0.08] sm:h-16 sm:w-[180px]">
                <Image
                  src="/logos/mpesa.svg"
                  alt="M-Pesa"
                  width={110}
                  height={59}
                  className="h-7 w-auto object-contain transition-transform duration-300 group-hover:scale-105 sm:h-8"
                />
              </div>
            </div>
          </div>
        </section>

        {/* —— Stats —— */}
        <section
          id="stats-confiance"
          className="border-y border-white/10 bg-white/[0.03]"
          aria-labelledby="stats-heading"
        >
          <div className={`mx-auto grid ${pageMaxWidthClass} ${pageGutterClass} gap-12 py-20 sm:grid-cols-3 sm:gap-8`}>
            <h2 id="stats-heading" className="sr-only">
              Indicateurs de confiance
            </h2>
            <StatBlock
              value={content.stats.rate}
              label={content.stats.rateLabel}
              prefersReducedMotion={!!prefersReducedMotion}
              delay={0}
              transition={transition}
            />
            <StatBlock
              value={content.stats.salary}
              label={content.stats.salaryLabel}
              prefersReducedMotion={!!prefersReducedMotion}
              delay={0.08}
              transition={transition}
            />
            <StatBlock
              value={content.stats.network}
              label={content.stats.networkLabel}
              prefersReducedMotion={!!prefersReducedMotion}
              delay={0.16}
              transition={transition}
            />
          </div>
        </section>

        {/* —— Features 2×2 —— */}
        <section id="fonctionnalites" className={`${pageGutterClass} py-24`} aria-labelledby="features-heading">
          <div className={`mx-auto ${pageMaxWidthClass}`}>
            <motion.h2
              id="features-heading"
              className="mx-auto max-w-3xl text-center text-[clamp(1.75rem,4vw,2.5rem)] font-bold font-heading leading-tight tracking-tight text-white"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 28 }}
              whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
              viewport={viewportOnce}
              transition={transition}
            >
              {content.features.title}
            </motion.h2>

            <motion.p
              className="mx-auto mt-4 max-w-2xl text-center text-lg text-white/65"
              initial={prefersReducedMotion ? false : { opacity: 0 }}
              whileInView={prefersReducedMotion ? undefined : { opacity: 1 }}
              viewport={viewportOnce}
              transition={{ ...transition, delay: 0.06 }}
            >
              {content.features.subtitle}
            </motion.p>

            <motion.div
              className="mt-16 grid gap-6 sm:grid-cols-2"
              variants={staggerContainer}
              initial="hidden"
              whileInView="visible"
              viewport={viewportOnce}
            >
              {content.features.items.map((item, i) => (
                <FeatureCard
                  key={item.title}
                  icon={FEATURE_ICONS[i]}
                  title={item.title}
                  description={item.description}
                  variants={staggerItem}
                />
              ))}
            </motion.div>
          </div>
        </section>

        {/* —— How it works —— */}
        <section
          id="etapes"
          className={`relative border-t border-white/10 ${pageGutterClass} py-24`}
          aria-labelledby="how-heading"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.12),transparent)]" />
          <div className={`relative mx-auto ${pageMaxWidthClass}`}>
            <motion.h2
              id="how-heading"
              className="mx-auto max-w-3xl text-center text-[clamp(1.75rem,4vw,2.35rem)] font-bold font-heading leading-tight tracking-tight text-white"
              initial={prefersReducedMotion ? false : { opacity: 0, y: 28 }}
              whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
              viewport={viewportOnce}
              transition={transition}
            >
              {content.programs.title}
            </motion.h2>
            <motion.p
              className="mx-auto mt-4 max-w-3xl text-center text-lg text-white/65"
              initial={prefersReducedMotion ? false : { opacity: 0 }}
              whileInView={prefersReducedMotion ? undefined : { opacity: 1 }}
              viewport={viewportOnce}
              transition={{ ...transition, delay: 0.06 }}
            >
              {content.programs.subtitle}
            </motion.p>

            <div className="relative mt-20">
              <div
                className="pointer-events-none absolute left-[8%] right-[8%] top-[76px] hidden h-px bg-gradient-to-r from-transparent via-white/15 to-transparent md:block"
                aria-hidden
              />
              <motion.div
                className="grid gap-12 md:grid-cols-3 md:gap-8"
                variants={staggerContainer}
                initial="hidden"
                whileInView="visible"
                viewport={viewportOnce}
              >
                {content.programs.items.map((item, i) => (
                  <ProgramStep
                    key={item.title}
                    icon={PROGRAM_ICONS[i]}
                    title={item.title}
                    description={item.description}
                    variants={staggerItem}
                  />
                ))}
              </motion.div>
            </div>
          </div>
        </section>

        {/* —— Final CTA —— */}
        <section
          id="cta-finale"
          className={`relative ${pageGutterClass} py-28`}
          aria-labelledby="cta-heading"
        >
          <div className="pointer-events-none absolute inset-0">
            <motion.div
              className="absolute left-1/2 top-1/2 h-[420px] w-[min(100%,720px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[hsl(var(--primary)/0.18)] blur-[100px]"
              aria-hidden
              animate={blobAnimate}
              transition={blobTransition}
            />
          </div>
          <motion.div
            className="relative mx-auto max-w-3xl text-center"
            initial={prefersReducedMotion ? false : { opacity: 0, y: 32 }}
            whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
            viewport={viewportOnce}
            transition={transition}
          >
            <h2
              id="cta-heading"
              className="text-[clamp(1.85rem,4.2vw,2.75rem)] font-bold font-heading leading-tight tracking-tight text-white"
            >
              {content.cta.title}
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/[0.68]">
              {content.cta.subtitle}
            </p>
            <a
              href={whatsappBotUrl}
              className="relative mt-12 inline-flex min-h-[56px] min-w-[min(100%,300px)] items-center justify-center overflow-hidden rounded-full bg-primary px-12 text-lg font-semibold font-heading text-primary-foreground shadow-[0_0_60px_-10px_hsl(var(--primary)/0.9)] transition-transform hover:scale-[1.03] active:scale-[0.98]"
            >
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent motion-reduce:hidden" />
              {content.cta.button}
            </a>
          </motion.div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-black/40 py-14 text-center backdrop-blur-sm">
        <p className={`mx-auto max-w-2xl ${pageGutterClass} text-sm leading-relaxed text-slate-400`}>
          {content.footer.description}
        </p>
        <p className="mt-3 text-xs text-slate-500">{content.footer.rights}</p>
      </footer>
    </div>
  );
}

function StatBlock({
  value,
  label,
  prefersReducedMotion,
  delay,
  transition,
}: {
  value: string;
  label: string;
  prefersReducedMotion: boolean;
  delay: number;
  transition: { duration: number; ease?: [number, number, number, number] };
}) {
  return (
    <motion.div
      className="text-center"
      initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
      whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={viewportOnce}
      transition={{ ...transition, delay: prefersReducedMotion ? 0 : delay }}
    >
      <div className="text-5xl font-bold tabular-nums tracking-tight text-primary sm:text-6xl">
        {value}
      </div>
      <div className="mt-3 text-[15px] font-medium text-slate-400">{label}</div>
    </motion.div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  variants,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  variants: {
    hidden: { opacity: number; y: number };
    visible: { opacity: number; y: number; transition?: object };
  };
}) {
  return (
    <motion.article variants={variants} className={`${glassCardClass} group relative overflow-hidden`}>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
        <Icon size={24} strokeWidth={1.75} aria-hidden />
      </div>
      <h3 className="text-lg font-semibold font-heading leading-snug text-white sm:text-xl">{title}</h3>
      <p className="mt-3 text-[15px] leading-relaxed text-white/[0.72]">{description}</p>
    </motion.article>
  );
}

function ProgramStep({
  icon: Icon,
  title,
  description,
  variants,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  variants: {
    hidden: { opacity: number; y: number };
    visible: { opacity: number; y: number; transition?: object };
  };
}) {
  return (
    <motion.div
      variants={variants}
      className={`${glassCardClass} relative z-10 flex flex-col items-center text-center`}
    >
      <div className="mb-4 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
        <Icon size={24} strokeWidth={1.75} aria-hidden />
      </div>
      <h3 className="text-lg font-semibold font-heading leading-snug text-white">{title}</h3>
      <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/[0.72]">{description}</p>
    </motion.div>
  );
}

function InteractiveChatDemo({ prefersReducedMotion }: { prefersReducedMotion: boolean }) {
  const [view, setView] = useState<DemoView>("vendeur");
  const [visibleCount, setVisibleCount] = useState(0);
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messages = useMemo(
    () => (view === "vendeur" ? VENDEUR_CONVERSATION : ACHETEUR_CONVERSATION),
    [view],
  );
  const visibleMessages = messages.slice(0, visibleCount);

  useEffect(() => {
    const timeoutIds: number[] = [];
    timeoutIds.push(
      window.setTimeout(() => {
        setVisibleCount(prefersReducedMotion ? messages.length : 0);
        setTyping(false);
      }, 0),
    );

    if (prefersReducedMotion) {
      return () => {
        timeoutIds.forEach((id) => window.clearTimeout(id));
      };
    }

    messages.forEach((message, index) => {
      const typingLead = estimateTypingLeadMs(message.text);
      const typingDelay = Math.max(message.delay * 1000 - typingLead, 0);
      const messageDelay = message.delay * 1000;

      if (message.sender === "bot") {
        timeoutIds.push(
          window.setTimeout(() => {
            setTyping(true);
          }, typingDelay),
        );
      }

      timeoutIds.push(
        window.setTimeout(() => {
          setVisibleCount(index + 1);
          if (message.sender === "bot") {
            setTyping(false);
          }
        }, messageDelay),
      );
    });

    return () => {
      timeoutIds.forEach((id) => window.clearTimeout(id));
    };
  }, [messages, prefersReducedMotion, view]);

  useLayoutEffect(() => {
    const scrollNode = scrollRef.current;
    if (!scrollNode) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      const targetTop = Math.max(scrollNode.scrollHeight - scrollNode.clientHeight, 0);
      scrollNode.scrollTo({
        top: targetTop,
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [prefersReducedMotion, typing, view, visibleCount]);

  return (
    <div className="mx-auto flex w-full max-w-[360px] flex-col items-center justify-start">
      <div className="mb-5 inline-flex flex-wrap items-center justify-center rounded-full border border-white/10 bg-white/[0.04] p-1 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setView("vendeur")}
          className={`relative rounded-full px-4 py-2 text-xs font-semibold transition-colors sm:text-sm ${
            view === "vendeur" ? "text-primary-foreground" : "text-slate-300 hover:text-white"
          }`}
        >
          {view === "vendeur" && (
            <motion.span
              layoutId="toggle-pill"
              className="absolute inset-0 -z-10 rounded-full bg-primary shadow-lg shadow-primary/30"
              transition={{ type: "spring", stiffness: 360, damping: 28 }}
            />
          )}
          Vue Vendeur
        </button>
        <button
          type="button"
          onClick={() => setView("acheteur")}
          className={`relative rounded-full px-4 py-2 text-xs font-semibold transition-colors sm:text-sm ${
            view === "acheteur" ? "text-primary-foreground" : "text-slate-300 hover:text-white"
          }`}
        >
          {view === "acheteur" && (
            <motion.span
              layoutId="toggle-pill"
              className="absolute inset-0 -z-10 rounded-full bg-primary shadow-lg shadow-primary/30"
              transition={{ type: "spring", stiffness: 360, damping: 28 }}
            />
          )}
          Vue Acheteur
        </button>
      </div>

      <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-3xl border-[6px] border-gray-800 bg-[#0b141a] shadow-2xl shadow-primary/20">
        <div className="flex items-center justify-between border-b border-white/10 bg-[#202c33] px-4 py-3 text-sm font-medium text-slate-100">
          <span className="truncate">🔒 Clairtus Bot</span>
          <span className="text-[11px] text-emerald-300">en ligne</span>
        </div>

        <div
          ref={scrollRef}
          className="h-[420px] overflow-y-auto overscroll-y-contain bg-[#0b141a] px-3 py-3 touch-pan-y [scrollbar-color:#334155_transparent] [scrollbar-width:thin]"
        >
          <motion.div key={view} className="space-y-2.5">
            {visibleMessages.map((message, index) => {
              const isUser = message.sender === "user";
              const textLength = message.text.length;
              const enterDuration = isUser
                ? 0.14
                : Math.min(0.34, 0.16 + textLength * 0.0005);
              return (
                <motion.div
                  key={`${view}-${index}`}
                  layout
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
                  animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
                  transition={{
                    duration: prefersReducedMotion ? 0.01 : enterDuration,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <div
                    className={`relative max-w-[88%] rounded-2xl px-3 py-2 text-[11px] leading-relaxed sm:max-w-[86%] sm:text-xs ${
                      isUser
                        ? "rounded-br-md bg-[#005c4b] text-[#e9fef6]"
                        : "rounded-bl-md bg-[#202c33] text-[#e9edef]"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`absolute bottom-0 h-2.5 w-2.5 rotate-45 ${
                        isUser ? "right-[-4px] bg-[#005c4b]" : "left-[-4px] bg-[#202c33]"
                      }`}
                    />
                    <span className="relative whitespace-pre-line">{message.text}</span>
                  </div>
                </motion.div>
              );
            })}
            {typing && (
              <motion.div
                className="flex justify-start"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <div className="relative rounded-2xl rounded-bl-md bg-[#202c33] px-3 py-2">
                  <span aria-hidden className="absolute bottom-0 left-[-4px] h-2.5 w-2.5 rotate-45 bg-[#202c33]" />
                  <div className="flex items-center gap-1.5">
                    <motion.span
                      className="h-1.5 w-1.5 rounded-full bg-slate-300/80"
                      animate={{ opacity: [0.35, 1, 0.35] }}
                      transition={{ duration: 0.9, repeat: Infinity, delay: 0 }}
                    />
                    <motion.span
                      className="h-1.5 w-1.5 rounded-full bg-slate-300/80"
                      animate={{ opacity: [0.35, 1, 0.35] }}
                      transition={{ duration: 0.9, repeat: Infinity, delay: 0.15 }}
                    />
                    <motion.span
                      className="h-1.5 w-1.5 rounded-full bg-slate-300/80"
                      animate={{ opacity: [0.35, 1, 0.35] }}
                      transition={{ duration: 0.9, repeat: Infinity, delay: 0.3 }}
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
