import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

function isPublicDemo(): boolean {
  const flag = process.env.QUICKCART_PUBLIC_DEMO ?? process.env.NEXT_PUBLIC_PUBLIC_DEMO ?? "";
  return flag === "1" || flag.toLowerCase() === "true";
}

/** Operations console: top bar, sidebar, command palette and the simulator dock. */
export default function OperationsLayout({ children }: { children: ReactNode }) {
  return <AppShell publicDemo={isPublicDemo()}>{children}</AppShell>;
}
