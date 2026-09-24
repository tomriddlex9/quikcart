import type { Metadata } from "next";
import { MlConsole } from "@/components/ml-console";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "ML platform",
};

export default function MlPage() {
  return (
    <>
      <PageHeader
        title="ML platform"
        description="The Phase 11 models serving the platform: live delivery-delay and demand predictions read straight from the Gold write-back tables, the anomaly stream the detectors emit, and honest documentation for every model — target, features, split, baselines and where predictions land."
      />
      <MlConsole />
    </>
  );
}
