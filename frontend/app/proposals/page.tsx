import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { ProposalsBoard } from "@/components/proposals-board";

export const metadata: Metadata = {
  title: "Proposals",
};

export default function ProposalsPage() {
  return (
    <>
      <PageHeader
        title="Approval queue"
        description="Every action waits here first. A named human approves or rejects; approved restocks execute in one audited transaction."
      />
      <ProposalsBoard />
    </>
  );
}
