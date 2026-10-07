import type { Metadata } from "next";
import { GoldBrowser } from "@/components/gold-browser";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "Gold marts",
};

export default function DataPage() {
  return (
    <>
      <PageHeader
        title="Gold marts"
        description="Every Gold table the platform promises — grain, key columns, build path — with live on-disk presence probed by the API."
      />
      <GoldBrowser />
    </>
  );
}
