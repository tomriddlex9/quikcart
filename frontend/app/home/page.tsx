import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/landing-page";

export const metadata: Metadata = {
  title: "Home",
  description:
    "QuickCart — local-first quick-commerce intelligence: lakehouse, ML, RAG, and a bounded agent.",
};

export default function HomePage() {
  return <LandingPage />;
}
