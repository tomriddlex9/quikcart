// Plain-language number formatting for the business console.
// Indian digit grouping; lakh (L) and crore (Cr) for large rupee amounts.

import type { MetricValue, Status } from "@/lib/business/types";

const LAKH = 100_000;
const CRORE = 10_000_000;

const grouped = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

function trimmed(value: number, digits = 1): string {
  return value.toFixed(digits).replace(/\.0+$/, "");
}

/** ₹86,400 · ₹4.2L · ₹1.3Cr. Under one lakh the full amount is shown. */
export function formatBusinessINR(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= CRORE) return `${sign}₹${trimmed(abs / CRORE)}Cr`;
  if (abs >= LAKH) return `${sign}₹${trimmed(abs / LAKH)}L`;
  return `${sign}₹${grouped.format(Math.round(abs))}`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return grouped.format(Math.round(value));
}

/** Input is a 0..1 fraction (the API's pct unit). */
export function formatShare(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  return `${trimmed(fraction * 100)}%`;
}

export function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${trimmed(value)} min`;
}

export type DeltaDirection = "up" | "down" | "flat" | "none";

export function deltaDirection(deltaPct: number | null | undefined): DeltaDirection {
  if (deltaPct === null || deltaPct === undefined || !Number.isFinite(deltaPct)) return "none";
  if (Math.abs(deltaPct) < 0.5) return "flat";
  return deltaPct > 0 ? "up" : "down";
}

/** "up 12% on the same day last week" / "about the same as …" / "no comparison yet". */
export function deltaSentence(
  deltaPct: number | null | undefined,
  compareLabel = "the same day last week",
): string {
  const dir = deltaDirection(deltaPct);
  if (dir === "none") return "No comparison yet";
  if (dir === "flat") return `About the same as ${compareLabel}`;
  const amount = trimmed(Math.abs(deltaPct as number), 0);
  return `${dir === "up" ? "Up" : "Down"} ${amount}% on ${compareLabel}`;
}

/** Is this change good news for the metric? null when it's flat or unknown. */
export function deltaIsGood(
  deltaPct: number | null | undefined,
  direction: MetricValue["direction"],
): boolean | null {
  const dir = deltaDirection(deltaPct);
  if (dir === "none" || dir === "flat") return null;
  return direction === "higher_better" ? dir === "up" : dir === "down";
}

export const STATUS_LABEL: Record<Status, string> = {
  good: "On track",
  watch: "Keep an eye",
  bad: "Needs help",
  unknown: "Not enough data",
};

export function statusLabel(status: Status): string {
  return STATUS_LABEL[status];
}

export function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function firstName(displayName: string | null | undefined): string {
  if (!displayName) return "there";
  return displayName.replace(/\s*\(.*\)\s*$/, "").split(" ")[0] || "there";
}
