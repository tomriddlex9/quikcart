import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BusinessShell } from "@/components/business/business-shell";
import { BusinessProvider } from "@/lib/business/business-context";
import { DataModeProvider } from "@/lib/data-mode";

export const metadata: Metadata = {
  title: { default: "QuickCart", template: "%s — QuickCart" },
};

export default function BusinessLayout({ children }: { children: ReactNode }) {
  return (
    <DataModeProvider>
      <BusinessProvider>
        <BusinessShell>{children}</BusinessShell>
      </BusinessProvider>
    </DataModeProvider>
  );
}
