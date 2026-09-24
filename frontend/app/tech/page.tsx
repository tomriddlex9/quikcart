import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { TechGrid } from "@/components/tech-grid";

export const metadata: Metadata = {
  title: "Tech stack",
};

export default function TechPage() {
  return (
    <>
      <PageHeader
        title="Technology inventory"
        description="Every pinned technology in the platform, the version it runs at, what job it does, and the phase that introduced it — from Python 3.12 and PostgreSQL 17.11 in Phase 0–1 to Qdrant, LangGraph and this Next.js console."
      />
      <TechGrid />
    </>
  );
}
