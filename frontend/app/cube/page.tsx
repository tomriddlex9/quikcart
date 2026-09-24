import type { Metadata } from "next";
import { CubeConsole } from "@/components/cube/cube-console";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "Cube",
};

export default function CubePage() {
  return (
    <>
      <PageHeader
        title="Cube"
        description="An OLAP cube over store × category × hour. Filter, slice, dice, roll up, drill down, and pivot — rendered live in a Three.js grid."
      />
      <CubeConsole />
    </>
  );
}
