import type { Metadata } from "next";
import { OverviewClient } from "@/components/overview";

export const metadata: Metadata = {
  title: "Overview",
};

export default function OverviewPage() {
  return <OverviewClient />;
}
