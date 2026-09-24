import type { Metadata } from "next";
import { LiveDashboard } from "@/components/live/live-dashboard";

export const metadata: Metadata = {
  title: "Live operations",
};

export default function LivePage() {
  return <LiveDashboard />;
}
