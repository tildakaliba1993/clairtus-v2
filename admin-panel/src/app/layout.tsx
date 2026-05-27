// src/app/layout.tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist_Mono, Red_Hat_Display } from "next/font/google";
import "./globals.css";

const redHatDisplay = Red_Hat_Display({
  variable: "--font-red-hat-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Clairtus | Le 1er Bot WhatsApp Tiers de Confiance en RDC",
  description:
    "Vendez et achetez en toute sécurité. Bloquez les fonds via Mobile Money, livrez en confiance et recevez vos paiements instantanément grâce à notre bot WhatsApp.",
  openGraph: {
    title: "Clairtus | Le 1er Bot WhatsApp Tiers de Confiance en RDC",
    description:
      "Vendez et achetez en toute sécurité. Bloquez les fonds via Mobile Money, livrez en confiance et recevez vos paiements instantanément grâce à notre bot WhatsApp.",
    type: "website",
    locale: "fr_CD",
    siteName: "Clairtus",
  },
  twitter: {
    card: "summary_large_image",
    title: "Clairtus | Le 1er Bot WhatsApp Tiers de Confiance en RDC",
    description:
      "Vendez et achetez en toute sécurité avec Mobile Money et notre bot WhatsApp.",
  },
  icons: {
    icon: "/favicon-clairtus.svg",
    shortcut: "/favicon-clairtus.svg",
    apple: "/favicon-clairtus.svg",
  },
};

import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// 🛡️ 1. IMPORT YOUR NEW LISTENER HERE
import AdminAlertsListener from "../components/AdminAlertsListener";

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${redHatDisplay.variable} ${geistMono.variable} h-full scroll-smooth antialiased`}
    >
      <body suppressHydrationWarning={true} className="min-h-full flex flex-col font-sans antialiased">
        
        {/* 🛡️ 2. PLUG IN THE LISTENER HERE */}
        <AdminAlertsListener />

        {children}
        <ToastContainer position="top-right" autoClose={5000} theme="dark" />
      </body>
    </html>
  );
}