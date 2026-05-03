import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OCC Disruption Recovery",
  description:
    "Decision-support tool for airline OCC during AOG, airport closure, weather, and late-arrival disruptions.",
  openGraph: {
    title: "OCC Disruption Recovery",
    description: "Advanced AI-powered airline recovery engine.",
    type: "website",
    siteName: "OCC Recovery",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <main className="flex-grow">{children}</main>
        <footer className="border-t border-border bg-panel/80 py-5 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 text-xs text-zinc-500">
            <p>
              © {new Date().getFullYear()} OCC Disruption Recovery. Internal use
              only.
            </p>
            <div className="space-x-4">
              <a href="/privacy" className="hover:text-foreground">
                Privacy
              </a>
              <a href="/terms" className="hover:text-foreground">
                Terms
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
