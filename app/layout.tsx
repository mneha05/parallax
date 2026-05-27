import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PARALLAX — Multi-Agent Reliability Investigation",
  description:
    "A director-specialist multi-agent platform for investigating component reliability data. Agents call real statistical skills and stream their reasoning live.",
};

export const viewport: Viewport = {
  themeColor: "#FAF8F2",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
