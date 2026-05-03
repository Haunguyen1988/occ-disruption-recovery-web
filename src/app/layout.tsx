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
        <main className="flex-grow">
          {children}
        </main>
        <footer className="border-t py-6 bg-slate-50">
          <div className="max-w-7xl mx-auto px-4 flex justify-between items-center text-sm text-slate-500">
            <p>© {new Date().getFullYear()} OCC Disruption Recovery. Internal Use Only.</p>
            <div className="space-x-4">
              <a href="/privacy" className="hover:underline">Privacy</a>
              <a href="/terms" className="hover:underline">Terms</a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
