import type { Metadata } from "next";
import { Suspense } from "react";
import localFont from "next/font/local";
import { PreviewModeBridge } from "@/components/preview/PreviewModeBridge";
import { UmamiScript } from "@/components/product-analytics/UmamiScript";
import "./globals.css";

const geistMono = localFont({
  src: "./fonts/geist-mono-latin-wght.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-geist-mono",
  display: "swap",
  adjustFontFallback: "Arial",
});

const barlowCondensed = localFont({
  src: [
    { path: "./fonts/barlow-condensed-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/barlow-condensed-latin-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/barlow-condensed-latin-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/barlow-condensed-latin-700.woff2", weight: "700", style: "normal" },
    { path: "./fonts/barlow-condensed-latin-800.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-barlow-condensed",
  display: "swap",
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  title: "Court Context",
  description: "Research NBA props, parlays, players, and games. Stats tell what happened; context helps explain why it matters.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistMono.variable} ${barlowCondensed.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        {children}
        <Suspense fallback={null}>
          <PreviewModeBridge />
        </Suspense>
        <UmamiScript />
      </body>
    </html>
  );
}
