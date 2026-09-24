import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { StreamlitEmbed } from "@/components/streamlit-embed";

export const metadata: Metadata = {
  title: "Streamlit dashboard",
};

export default function StreamlitPage() {
  return (
    <>
      <PageHeader
        title="Streamlit dashboard"
        description="The original Phase 10 operations UI — 8 pages of Gold-mart analytics, ML predictions and the action approval queue, served straight from Python."
      />
      <StreamlitEmbed />
    </>
  );
}
