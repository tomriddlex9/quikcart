// Demo-first contracts for the /layers (medallion operations) and /cube
// (OLAP console) showcase pages. Both pages call the API first and fall back
// to the DEMO_* fixtures below whenever the API does not answer — the same
// "live | demo" honesty pattern used across the rest of the console.

export type MedallionLayer = "bronze" | "silver" | "gold" | "raw" | "quarantine";

export type LayerOperation = {
  id: string;
  layer: MedallionLayer;
  name: string;
  engine: "pyspark" | "python" | "sql" | "cdc" | "stream" | "ml";
  summary: string;
  code: string;
  inputs: string[];
  outputs: string[];
  impact: {
    rows_in: number;
    rows_out: number;
    rows_quarantined: number;
    columns_added: string[];
    columns_dropped: string[];
    quality_lift_pct: number;
    latency_ms: number;
    null_rate_before: number;
    null_rate_after: number;
  };
};

export type LayerSample = {
  layer: MedallionLayer;
  before: Record<string, unknown>[];
  after: Record<string, unknown>[];
  notes: string[];
};

export type LayersCatalog = {
  generated_at: string;
  operations: LayerOperation[];
  layer_summaries: Record<
    string,
    { tables: number; ops: number; row_estimate: number; purpose: string }
  >;
};

export type CubeDim = { name: string; members: string[] };
export type CubeMeasure = { name: string; label: string; format: "int" | "currency" | "pct" | "float" };
export type CubeCell = {
  id: string;
  coords: Record<string, string>;
  values: Record<string, number>;
  highlight?: boolean;
};

export type CubeOp = "filter" | "slice" | "dice" | "rollup" | "drill" | "pivot" | "sql" | "reset";

export type CubeAnimation = {
  kind: "pulse" | "shrink" | "expand" | "recolor" | "split" | "merge";
  cell_ids: string[];
  duration_ms: number;
};

export type CubeState = {
  generated_at: string;
  title: string;
  dimensions: CubeDim[];
  measures: CubeMeasure[];
  cells: CubeCell[];
  active_op: string | null;
  history: string[];
  animation: CubeAnimation | null;
};

export type CubeOperateRequest = {
  op: CubeOp;
  args?: Record<string, unknown>;
  state?: CubeState;
};

// ---------------------------------------------------------------------------
// Demo fixtures
// ---------------------------------------------------------------------------

function impact(partial: Partial<LayerOperation["impact"]>): LayerOperation["impact"] {
  return {
    rows_in: 0,
    rows_out: 0,
    rows_quarantined: 0,
    columns_added: [],
    columns_dropped: [],
    quality_lift_pct: 0,
    latency_ms: 0,
    null_rate_before: 0,
    null_rate_after: 0,
    ...partial,
  };
}

export const DEMO_LAYERS_CATALOG: LayersCatalog = {
  generated_at: "2026-09-25T04:00:00Z",
  layer_summaries: {
    raw: { tables: 9, ops: 0, row_estimate: 264_000, purpose: "PostgreSQL operational source of truth" },
    bronze: { tables: 7, ops: 4, row_estimate: 258_400, purpose: "Append-only landing, one-to-one with source payloads" },
    silver: { tables: 6, ops: 5, row_estimate: 231_900, purpose: "Conformed, typed, deduplicated business entities" },
    quarantine: { tables: 3, ops: 3, row_estimate: 4_120, purpose: "Rows that failed validation, held for inspection" },
    gold: { tables: 5, ops: 3, row_estimate: 41_760, purpose: "Aggregated, decision-ready marts and features" },
  },
  operations: [
    {
      id: "bronze-cdc-orders",
      layer: "bronze",
      name: "cdc_orders_ingest",
      engine: "cdc",
      summary: "Debezium captures row-level changes on postgres.public.orders and lands them append-only.",
      code: `debezium.connector(
  table="public.orders",
  slot="quickcart_orders_slot",
).stream_to(
  topic="cdc.quickcart.public.orders",
  sink="delta:/bronze/orders_cdc",
)`,
      inputs: ["postgres.public.orders"],
      outputs: ["bronze.orders_cdc"],
      impact: impact({
        rows_in: 184_205,
        rows_out: 184_205,
        columns_added: ["_cdc_op", "_cdc_ts_ms", "_cdc_lsn"],
        quality_lift_pct: 0,
        latency_ms: 420,
        null_rate_before: 0.0,
        null_rate_after: 0.0,
      }),
    },
    {
      id: "bronze-batch-inventory",
      layer: "bronze",
      name: "batch_inventory_snapshot",
      engine: "pyspark",
      summary: "Airflow-triggered batch job snapshots inventory_updates into bronze once per hour.",
      code: `df = (
  spark.read.jdbc(pg_url, "inventory_updates")
  .withColumn("ingested_at", current_timestamp())
  .withColumn("source_file", lit(batch_id))
)
df.write.format("delta").mode("append").save("/bronze/inventory_updates")`,
      inputs: ["postgres.public.inventory_updates"],
      outputs: ["bronze.inventory_updates"],
      impact: impact({
        rows_in: 42_600,
        rows_out: 42_600,
        columns_added: ["ingested_at", "source_file"],
        latency_ms: 3_150,
        null_rate_before: 0.02,
        null_rate_after: 0.02,
      }),
    },
    {
      id: "bronze-stream-rider-locations",
      layer: "bronze",
      name: "stream_rider_locations",
      engine: "stream",
      summary: "Rider app pings land on Redpanda and are landed to bronze every 30s via a Spark structured stream.",
      code: `spark.readStream.format("kafka")
  .option("subscribe", "rider.locations.v1")
  .load()
  .writeStream.format("delta")
  .trigger(processingTime="30 seconds")
  .start("/bronze/rider_locations")`,
      inputs: ["redpanda.rider.locations.v1"],
      outputs: ["bronze.rider_locations"],
      impact: impact({
        rows_in: 96_800,
        rows_out: 96_800,
        columns_added: ["_kafka_offset", "_kafka_partition"],
        latency_ms: 890,
        null_rate_before: 0.0,
        null_rate_after: 0.0,
      }),
    },
    {
      id: "bronze-batch-support-tickets",
      layer: "bronze",
      name: "batch_support_tickets",
      engine: "python",
      summary: "Nightly extract of the support desk's tickets and escalations tables.",
      code: `for table in ("tickets", "escalations"):
    rows = pg.fetch_all(f"select * from {table} where updated_at >= :since")
    write_delta(f"/bronze/{table}", rows, mode="append")`,
      inputs: ["postgres.public.tickets", "postgres.public.escalations"],
      outputs: ["bronze.tickets", "bronze.escalations"],
      impact: impact({
        rows_in: 8_940,
        rows_out: 8_940,
        columns_added: ["ingested_at"],
        latency_ms: 1_640,
        null_rate_before: 0.04,
        null_rate_after: 0.04,
      }),
    },
    {
      id: "silver-orders-conform",
      layer: "silver",
      name: "conform_orders",
      engine: "pyspark",
      summary: "Type-cast, dedupe by order_id keeping latest CDC op, and drop rows missing a store_id.",
      code: `w = Window.partitionBy("order_id").orderBy(desc("_cdc_ts_ms"))
clean = (
  bronze.withColumn("rn", row_number().over(w))
  .filter(col("rn") == 1)
  .filter(col("store_id").isNotNull())
)
clean.write.format("delta").mode("overwrite").save("/silver/orders")`,
      inputs: ["bronze.orders_cdc"],
      outputs: ["silver.orders", "quarantine.orders_missing_store"],
      impact: impact({
        rows_in: 184_205,
        rows_out: 183_996,
        rows_quarantined: 209,
        columns_dropped: ["_cdc_op", "_cdc_lsn"],
        quality_lift_pct: 12.4,
        latency_ms: 5_240,
        null_rate_before: 0.031,
        null_rate_after: 0.0,
      }),
    },
    {
      id: "silver-inventory-validate",
      layer: "silver",
      name: "validate_inventory",
      engine: "pyspark",
      summary: "Rejects negative on-hand quantities and unknown SKUs into quarantine instead of dropping silently.",
      code: `valid = bronze.filter((col("on_hand_qty") >= 0) & col("sku").isin(known_skus))
invalid = bronze.subtract(valid)
valid.write.format("delta").mode("overwrite").save("/silver/inventory")
invalid.write.format("delta").mode("append").save("/quarantine/inventory_updates")`,
      inputs: ["bronze.inventory_updates"],
      outputs: ["silver.inventory", "quarantine.inventory_updates"],
      impact: impact({
        rows_in: 42_600,
        rows_out: 41_845,
        rows_quarantined: 755,
        quality_lift_pct: 8.1,
        latency_ms: 2_010,
        null_rate_before: 0.021,
        null_rate_after: 0.0,
      }),
    },
    {
      id: "silver-rider-locations-dedupe",
      layer: "silver",
      name: "dedupe_rider_locations",
      engine: "pyspark",
      summary: "Collapses duplicate pings within a 5s window per rider and clips out-of-range GPS coordinates.",
      code: `w = window(col("event_time"), "5 seconds")
deduped = (
  bronze.groupBy("rider_id", w)
  .agg(last("lat").alias("lat"), last("lng").alias("lng"))
  .filter(col("lat").between(-90, 90) & col("lng").between(-180, 180))
)`,
      inputs: ["bronze.rider_locations"],
      outputs: ["silver.rider_locations"],
      impact: impact({
        rows_in: 96_800,
        rows_out: 71_260,
        rows_quarantined: 340,
        quality_lift_pct: 5.6,
        latency_ms: 1_780,
        null_rate_before: 0.006,
        null_rate_after: 0.0,
      }),
    },
    {
      id: "silver-tickets-enrich",
      layer: "silver",
      name: "enrich_tickets",
      engine: "python",
      summary: "Joins tickets to escalations and orders, and normalizes free-text priority into an enum.",
      code: `enriched = tickets.merge(escalations, on="ticket_id", how="left") \\
  .merge(orders[["order_id", "store_id"]], on="order_id", how="left")
enriched["priority"] = enriched["priority_raw"].map(PRIORITY_MAP).fillna("normal")`,
      inputs: ["bronze.tickets", "bronze.escalations", "silver.orders"],
      outputs: ["silver.tickets"],
      impact: impact({
        rows_in: 8_940,
        rows_out: 8_812,
        rows_quarantined: 128,
        columns_added: ["priority", "store_id"],
        quality_lift_pct: 4.2,
        latency_ms: 940,
        null_rate_before: 0.07,
        null_rate_after: 0.01,
      }),
    },
    {
      id: "silver-weather-news-join",
      layer: "silver",
      name: "join_weather_news_context",
      engine: "python",
      summary: "External weather and local-news feeds are normalized and keyed by store_city + hour for downstream ML features.",
      code: `weather_h = weather_raw.resample("1H", on="observed_at").mean(numeric_only=True)
news_h = news_raw.groupby([pd.Grouper(key="published_at", freq="1H"), "city"]).size()
context = weather_h.join(news_h, how="outer").reset_index()`,
      inputs: ["raw.weather_feed", "raw.news_feed"],
      outputs: ["silver.city_hour_context"],
      impact: impact({
        rows_in: 19_680,
        rows_out: 19_680,
        columns_added: ["temp_c", "precip_mm", "news_volume"],
        quality_lift_pct: 1.8,
        latency_ms: 610,
        null_rate_before: 0.11,
        null_rate_after: 0.03,
      }),
    },
    {
      id: "gold-store-hourly-metrics",
      layer: "gold",
      name: "rollup_store_hourly_metrics",
      engine: "sql",
      summary: "Hourly grain rollup of orders, GMV, and late-delivery rate per store — the primary ops mart.",
      code: `select store_id, date_trunc('hour', created_at) as hour,
       count(*) as orders, sum(order_total) as gmv,
       avg((is_late)::int)::double precision as late_rate
from silver.orders o join silver.deliveries d using (order_id)
group by 1, 2`,
      inputs: ["silver.orders", "silver.deliveries"],
      outputs: ["gold.store_hourly_metrics"],
      impact: impact({
        rows_in: 183_996,
        rows_out: 28_940,
        quality_lift_pct: 0,
        latency_ms: 2_340,
        null_rate_before: 0.0,
        null_rate_after: 0.0,
      }),
    },
    {
      id: "gold-inventory-health",
      layer: "gold",
      name: "rollup_inventory_health",
      engine: "sql",
      summary: "Stock cover hours and reorder flags computed per store × SKU from silver inventory and sales velocity.",
      code: `select store_id, sku,
       on_hand_qty,
       on_hand_qty / greatest(avg_hourly_sales, 0.01) as stock_cover_hours,
       stock_cover_hours < reorder_threshold as is_below_reorder_point
from silver.inventory join silver.sales_velocity using (store_id, sku)`,
      inputs: ["silver.inventory", "silver.orders"],
      outputs: ["gold.inventory_health"],
      impact: impact({
        rows_in: 41_845,
        rows_out: 6_930,
        quality_lift_pct: 0,
        latency_ms: 1_120,
        null_rate_before: 0.0,
        null_rate_after: 0.0,
      }),
    },
    {
      id: "gold-ml-delivery-writeback",
      layer: "gold",
      name: "ml_delivery_prediction_writeback",
      engine: "ml",
      summary: "Delivery-delay model scores every in-flight order and writes P(late) back to a gold feature table.",
      code: `preds = delivery_model.predict_proba(features)[:, 1]
gold_write(
  "gold.delivery_predictions",
  order_id=features["order_id"], p_late=preds, scored_at=now(),
)`,
      inputs: ["silver.orders", "silver.rider_locations", "silver.city_hour_context"],
      outputs: ["gold.delivery_predictions"],
      impact: impact({
        rows_in: 5_890,
        rows_out: 5_890,
        columns_added: ["p_late", "scored_at"],
        quality_lift_pct: 0,
        latency_ms: 340,
        null_rate_before: 0.0,
        null_rate_after: 0.0,
      }),
    },
  ],
};

export const DEMO_CUBE_STATE: CubeState = {
  generated_at: "2026-09-25T04:00:00Z",
  title: "Store × Category × Hour — orders / GMV / late rate",
  dimensions: [
    { name: "store_city", members: ["Bengaluru", "Pune", "Hyderabad"] },
    { name: "category", members: ["Produce", "Dairy", "Snacks", "Household"] },
    { name: "hour_bucket", members: ["08-11", "11-14", "14-17", "17-20", "20-23"] },
  ],
  measures: [
    { name: "orders", label: "Orders", format: "int" },
    { name: "gmv", label: "GMV", format: "currency" },
    { name: "late_rate", label: "Late rate", format: "pct" },
  ],
  cells: buildDemoCells(),
  active_op: null,
  history: ["reset → base cube (3 cities × 4 categories × 5 hours)"],
  animation: null,
};

function buildDemoCells(): CubeCell[] {
  const cities = ["Bengaluru", "Pune", "Hyderabad"];
  const categories = ["Produce", "Dairy", "Snacks", "Household"];
  const hours = ["08-11", "11-14", "14-17", "17-20", "20-23"];
  const cells: CubeCell[] = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (const city of cities) {
    const cityFactor = city === "Bengaluru" ? 1.35 : city === "Pune" ? 1.05 : 0.85;
    for (const category of categories) {
      const catFactor = category === "Produce" ? 1.2 : category === "Dairy" ? 1.0 : category === "Snacks" ? 0.85 : 0.65;
      for (const hour of hours) {
        const hourFactor = hour === "17-20" ? 1.4 : hour === "11-14" ? 1.15 : hour === "20-23" ? 0.9 : 0.7;
        const base = 40 * cityFactor * catFactor * hourFactor;
        const orders = Math.round(base * (0.85 + rand() * 0.3));
        const gmv = Math.round(orders * (180 + rand() * 90));
        const lateRate = Math.min(0.32, Math.max(0.02, 0.06 * hourFactor * (0.7 + rand() * 0.6)));
        cells.push({
          id: `${city}|${category}|${hour}`,
          coords: { store_city: city, category, hour_bucket: hour },
          values: { orders, gmv, late_rate: Number(lateRate.toFixed(3)) },
        });
      }
    }
  }
  return cells;
}

export const DEMO_LAYER_SAMPLES: Record<string, LayerSample> = {
  "bronze-cdc-orders": {
    layer: "bronze",
    before: [
      { order_id: 500123, customer_id: 9021, store_id: 4, status: "PLACED", total_amount: 412.5, created_at: "2026-09-25T03:41:02Z" },
    ],
    after: [
      {
        order_id: 500123,
        customer_id: 9021,
        store_id: 4,
        status: "PLACED",
        total_amount: 412.5,
        created_at: "2026-09-25T03:41:02Z",
        _cdc_op: "c",
        _cdc_ts_ms: 1758768062000,
        _cdc_lsn: "0/1A2FF30",
      },
    ],
    notes: ["Debezium adds change-metadata columns but never mutates the source payload."],
  },
  "silver-orders-conform": {
    layer: "silver",
    before: [
      { order_id: 500118, customer_id: 9017, store_id: null, status: "placed", total_amount: "398.00", _cdc_op: "u", _cdc_ts_ms: 1758767990000 },
      { order_id: 500118, customer_id: 9017, store_id: 4, status: "placed", total_amount: "398.00", _cdc_op: "u", _cdc_ts_ms: 1758768001000 },
    ],
    after: [
      { order_id: 500118, customer_id: 9017, store_id: 4, order_status: "PLACED", order_total: 398.0, created_at: "2026-09-25T03:40:01Z" },
    ],
    notes: [
      "Keeps only the latest CDC event per order_id.",
      "Row with a null store_id at the earlier timestamp is superseded, not the reason for quarantine here.",
    ],
  },
  "silver-inventory-validate": {
    layer: "silver",
    before: [
      { store_id: 4, sku: "QC-108", on_hand_qty: -3, updated_at: "2026-09-25T03:12:00Z" },
      { store_id: 4, sku: "QC-109", on_hand_qty: 42, updated_at: "2026-09-25T03:12:00Z" },
    ],
    after: [{ store_id: 4, sku: "QC-109", on_hand_qty: 42, updated_at: "2026-09-25T03:12:00Z" }],
    notes: ["QC-108 has a negative on-hand quantity and is routed to quarantine.inventory_updates for inspection."],
  },
  "gold-store-hourly-metrics": {
    layer: "gold",
    before: [
      { order_id: 500001, store_id: 4, order_total: 210.0, created_at: "2026-09-25T02:05:00Z", is_late: false },
      { order_id: 500002, store_id: 4, order_total: 640.0, created_at: "2026-09-25T02:41:00Z", is_late: true },
    ],
    after: [{ store_id: 4, hour: "2026-09-25T02:00:00Z", orders: 2, gmv: 850.0, late_rate: 0.5 }],
    notes: ["Row-level orders and deliveries collapse into one hourly grain row per store."],
  },
};
