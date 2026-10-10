import type { Metadata } from "next";
import { OpsAgentView } from "@/components/assistant/ops-agent-view";

export const metadata: Metadata = {
  title: "Agent console",
};

export default function AgentPage() {
  return <OpsAgentView />;
}
