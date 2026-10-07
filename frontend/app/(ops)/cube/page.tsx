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
        description="An OLAP console over the same store x category x hour fact table used across the console — filter, slice, dice, rollup, drill, pivot, or run a WHERE clause, rendered live in 3D."
      />
      <CubeConsole />
    </>
  );
}
