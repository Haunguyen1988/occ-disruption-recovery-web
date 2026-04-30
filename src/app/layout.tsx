import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OCC Disruption Recovery",
  description:
    "Decision-support tool for airline OCC during AOG, airport closure, weather, and late-arrival disruptions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
