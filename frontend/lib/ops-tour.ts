/** Persistence + event bus for the ops first-run tour. */

export const OPS_TOUR_STORAGE_PREFIX = "qc_ops_tour_v1:";
export const OPS_TOUR_REPLAY_EVENT = "qc:ops-tour-replay";

export type OpsTourStep = {
  title: string;
  body: string;
  href: string;
  cta: string;
};

export type OpsTourPlan = {
  persona: string;
  steps: OpsTourStep[];
};

const PLANS: Record<string, OpsTourStep[]> = {
  ops_manager: [
    {
      title: "Watch the floor live",
      body: "Live shows orders as they flow through the pipeline — the first place to look when something feels off.",
      href: "/live",
      cta: "Open Live",
    },
    {
      title: "Ask the lakehouse",
      body: "Query lets you run SQL or ask in plain English. Results stay read-only unless a person approves a change.",
      href: "/query",
      cta: "Open Query",
    },
    {
      title: "Check pipeline health",
      body: "Logs shows CDC lag, job status, and recent failures so you know the stream is still catching up.",
      href: "/logs",
      cta: "Open Logs",
    },
  ],
  inventory_manager: [
    {
      title: "Start from Overview",
      body: "Overview summarises stock risk, orders, and late deliveries so you can decide what to act on first.",
      href: "/",
      cta: "Open Overview",
    },
    {
      title: "Approve restock proposals",
      body: "Proposals are suggestions only. You review each one and approve or reject — nothing changes without you.",
      href: "/proposals",
      cta: "Open Proposals",
    },
    {
      title: "Talk to the agent",
      body: "The agent can draft a restock proposal from the numbers. You still make the call.",
      href: "/agent",
      cta: "Open Agent",
    },
  ],
  admin: [
    {
      title: "See how the system fits together",
      body: "System maps the lakehouse, services, and agents so you can orient newcomers and audits.",
      href: "/system",
      cta: "Open System",
    },
    {
      title: "Trust and audit",
      body: "Trust shows who can approve what and the recent audit trail. Admins cannot approve proposals themselves.",
      href: "/trust",
      cta: "Open Trust",
    },
    {
      title: "Watch pipeline status",
      body: "Logs is the ops status board — CDC lag, job health, and recent failures.",
      href: "/logs",
      cta: "Open Logs",
    },
  ],
};

export function opsTourPlan(persona: string | undefined | null): OpsTourPlan | null {
  if (!persona) return null;
  const steps = PLANS[persona];
  if (!steps) return null;
  return { persona, steps };
}

export function opsTourStorageKey(persona: string): string {
  return `${OPS_TOUR_STORAGE_PREFIX}${persona}`;
}

export function hasCompletedOpsTour(persona: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(opsTourStorageKey(persona)) === "1";
  } catch {
    return true;
  }
}

export function markOpsTourComplete(persona: string): void {
  try {
    window.localStorage.setItem(opsTourStorageKey(persona), "1");
  } catch {
    // private mode
  }
}

export function clearOpsTourComplete(persona?: string): void {
  try {
    if (persona) {
      window.localStorage.removeItem(opsTourStorageKey(persona));
      return;
    }
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(OPS_TOUR_STORAGE_PREFIX)) window.localStorage.removeItem(key);
    }
  } catch {
    // private mode
  }
}

/** Fire from the More menu; OpsTour listens and reopens. */
export function replayOpsTour(): void {
  if (typeof window === "undefined") return;
  clearOpsTourComplete();
  window.dispatchEvent(new CustomEvent(OPS_TOUR_REPLAY_EVENT));
}
