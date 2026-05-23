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
  title: "Clairtus | Sécurisez vos transactions Mobile Money en RDC",
  description:
    "Fini les arnaques et vendeurs fantômes. Clairtus sécurise vos paiements sur WhatsApp. L'argent n'est transféré qu'à la livraison. Démarrez !",
  keywords: [
    "paiement sécurisé",
    "Mobile Money",
    "M-Pesa RDC",
    "Orange Money",
    "entiercement",
    "garantie locative",
    "commerce informel",
    "éviter arnaque",
  ],
  authors: [{ name: "Clairtus" }],
  creator: "Clairtus",
  publisher: "Clairtus",
  metadataBase: new URL(process.env.SITE_URL || "https://clairtus.com"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Clairtus | Sécurisez vos transactions Mobile Money en RDC",
    description:
      "Fini les arnaques et vendeurs fantômes. Clairtus sécurise vos paiements sur WhatsApp. L'argent n'est transféré qu'à la livraison. Démarrez !",
    url: "https://clairtus.com",
    siteName: "Clairtus",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Clairtus - Tiers de Confiance en RDC",
      },
    ],
    locale: "fr_CD",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Clairtus | Sécurisez vos transactions Mobile Money en RDC",
    description:
      "Fini les arnaques et vendeurs fantômes. Clairtus sécurise vos paiements sur WhatsApp. L'argent n'est transféré qu'à la livraison. Démarrez !",
    images: ["/og-image.png"],
    creator: "@clairtus",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: "/favicon-clairtus.svg",
    shortcut: "/favicon-clairtus.svg",
    apple: "/favicon-clairtus.svg",
  },
};

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
      <body className="min-h-full flex flex-col font-sans antialiased">
        {/* JSON-LD Schema for Local Business / Software App */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              "name": "Clairtus",
              "operatingSystem": "WhatsApp",
              "applicationCategory": "FinanceApplication",
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "CDF"
              },
              "description": "Bot WhatsApp tiers de confiance pour sécuriser les transactions commerciales en RDC via M-Pesa, Orange Money et Airtel Money.",
              "url": "https://clairtus.com",
              "provider": {
                "@type": "Organization",
                "name": "Clairtus",
                "address": {
                  "@type": "PostalAddress",
                  "addressCountry": "CD",
                  "addressLocality": "Kinshasa"
                }
              }
            }),
          }}
        />
        {children}
      </body>
    </html>
  );
}
