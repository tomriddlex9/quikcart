import type { LivePipeline } from "@/lib/live-types";
import type { SystemStatus } from "@/lib/types";

export function tablePresent(value: unknown): { label: string; present: boolean | null } {
  if (typeof value === "boolean") return { label: String(value), present: value };
  if (typeof value === "number") return { label: `${value} rows`, present: value > 0 };
  if (value === null || value === undefined) return { label: "unknown", present: null };
  return { label: String(value), present: Boolean(value) };
}

export function countGoldTablesPresent(status: SystemStatus): { present: number; total: number } {
  const entries = Object.values(status.data_root_tables ?? {});
  const total = entries.length;
  const present = entries.filter((v) => tablePresent(v).present === true).length;
  return { present, total };
}

export function formatPipelineLag(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

/**
 * 0–100 score from gold presence, stage health, and quarantine volume.
 * Returns null until the live pipeline document has arrived — no stand-in score.
 */
export function computeQualityScore(
  status: SystemStatus,
  pipeline: LivePipeline | null,
): number | null {
  if (pipeline === null) return null;
  const { present, total } = countGoldTablesPresent(status);
  const goldRatio = total > 0 ? present / total : 0;

  const heartbeats = pipeline.heartbeats ?? [];
  const stageRatio =
    heartbeats.length > 0
      ? heartbeats.filter((hb) => !hb.error).length / heartbeats.length
      : 0;

  const quarantineRows = Object.values(pipeline.counts.quarantine ?? {}).reduce(
    (sum, n) => sum + n,
    0,
  );
  const quarantinePenalty = quarantineRows > 500 ? 0.08 : quarantineRows > 0 ? 0.03 : 0;

  const raw = goldRatio * 40 + stageRatio * 60 - quarantinePenalty * 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}
