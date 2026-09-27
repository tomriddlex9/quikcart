import { formatCompactINR, formatINR, formatPercent } from "@/lib/format";
import type { LivePipeline, LiveSnapshot } from "@/lib/live-types";
import type { ActivityLogEntry, AnomalyRow, Proposal } from "@/lib/types";

/** Merge live snapshot, pipeline heartbeats, anomalies and proposals — newest first. */
export function buildActivityLog(
  snapshot: LiveSnapshot | null,
  pipeline: LivePipeline | null,
  anomalies: AnomalyRow[] | null,
  proposals: Proposal[] | null,
): ActivityLogEntry[] {
  const entries: ActivityLogEntry[] = [];

  if (snapshot && snapshot.generated_at !== new Date(0).toISOString()) {
    entries.push({
      id: `live-${snapshot.generated_at}`,
      ts: snapshot.generated_at,
      level: "info",
      source: "live",
      message:
        `orders_1m=${snapshot.orders_1m} ` +
        `gmv_15m=${formatCompactINR(snapshot.gmv_15m)} ` +
        `active_deliveries=${snapshot.active_deliveries}`,
    });
    for (const order of snapshot.recent_orders.slice(0, 6)) {
      entries.push({
        id: `order-${order.order_id}`,
        ts: order.placed_at,
        level: "info",
        source: "orders",
        message: `#${order.order_id} store=${order.store_id} status=${order.status} ${formatINR(order.total_amount)}`,
      });
    }
  }

  if (pipeline) {
    for (const hb of pipeline.heartbeats) {
      const ts = hb.updated_at ?? hb.last_run_at;
      if (!ts) continue;
      entries.push({
        id: `stage-${hb.stage}-${ts}`,
        ts,
        level: hb.error ? "error" : "info",
        source: "pipeline",
        message: hb.error
          ? `${hb.stage} error=${hb.error}`
          : `${hb.stage} rows_in=${hb.rows_in} rows_out=${hb.rows_out}` +
            (hb.lag_seconds != null ? ` lag=${Math.round(hb.lag_seconds)}s` : ""),
      });
    }
  }

  for (const anomaly of anomalies ?? []) {
    entries.push({
      id: `anomaly-${anomaly.anomaly_type}-${anomaly.store_id}-${anomaly.observed_on}`,
      ts: anomaly.observed_on,
      level: anomaly.severity?.toUpperCase() === "HIGH" ? "error" : "warn",
      source: "anomaly",
      message:
        `${anomaly.anomaly_type} store=${anomaly.store_id} ` +
        `observed=${formatPercent(anomaly.observed_value)} expected=${formatPercent(anomaly.expected_value)} ` +
        `severity=${anomaly.severity}`,
    });
  }

  for (const proposal of proposals ?? []) {
    const ts = proposal.updated_at ?? proposal.created_at;
    if (!ts) continue;
    entries.push({
      id: `proposal-${proposal.proposal_id}-${ts}`,
      ts,
      level: "info",
      source: "proposal",
      message:
        `#${proposal.proposal_id} ${proposal.proposal_type} status=${proposal.status}` +
        (proposal.approved_by ? ` by=${proposal.approved_by}` : ""),
    });
  }

  entries.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  return entries.slice(0, 40);
}
