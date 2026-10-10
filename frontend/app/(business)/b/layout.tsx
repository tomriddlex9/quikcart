import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BusinessShell } from "@/components/business/business-shell";
import { KpiJourneyInspector } from "@/components/business/kpi-journey/kpi-journey-inspector";
import { BusinessProvider } from "@/lib/business/business-context";
import { ProvenanceProvider } from "@/lib/business/provenance-context";
import { DataModeProvider } from "@/lib/data-mode";

export const metadata: Metadata = {
  title: { default: "QuickCart", template: "%s — QuickCart" },
};

export default function BusinessLayout({ children }: { children: ReactNode }) {
  return (
    <DataModeProvider>
      <BusinessProvider>
        <ProvenanceProvider>
          <BusinessShell>{children}</BusinessShell>
          <KpiJourneyInspector />
        </ProvenanceProvider>
      </BusinessProvider>
    </DataModeProvider>
  );
}
