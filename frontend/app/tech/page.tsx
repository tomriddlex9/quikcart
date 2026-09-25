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
        description="Pinned versions from pyproject.toml, docker-compose.yml and package.json, with the Compose profile and host port."
      />
      <TechGrid />
    </>
  );
}
