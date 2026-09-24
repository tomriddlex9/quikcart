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
        description="Delivery-delay and demand predictions read from the Gold write-back tables, the anomaly stream, and a documented card per model."
      />
      <MlConsole />
    </>
  );
}
