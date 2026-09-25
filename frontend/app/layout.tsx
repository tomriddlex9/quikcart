import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { PrefsProvider } from "@/lib/prefs";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "QuickCart",
    template: "%s — QuickCart",
  },
  description:
    "Local-first quick-commerce intelligence console: lakehouse, ML, RAG, and a bounded agent.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen font-sans">
        <ThemeProvider>
          <PrefsProvider>
            <TooltipProvider delay={200}>
              <AppShell>{children}</AppShell>
              <Toaster richColors position="bottom-right" />
            </TooltipProvider>
          </PrefsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
