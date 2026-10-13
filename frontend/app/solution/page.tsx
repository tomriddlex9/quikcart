import { Suspense } from "react";
import type { Metadata } from "next";
import { SolutionPage } from "@/components/solution/solution-page";

export const metadata: Metadata = {
  title: "QuickCart",
  description: "QuickCart dashboards for Business and Operations personas, on the bundled dummy data.",
};

export default function Page() {
  return (
    <Suspense>
      <SolutionPage />
    </Suspense>
  );
}
