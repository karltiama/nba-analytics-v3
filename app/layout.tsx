import type { Metadata } from "next";
import { Suspense } from "react";
import { Barlow_Condensed, Geist_Mono } from "next/font/google";
import { PreviewModeBridge } from "@/components/preview/PreviewModeBridge";
import { UmamiScript } from "@/components/product-analytics/UmamiScript";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
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
