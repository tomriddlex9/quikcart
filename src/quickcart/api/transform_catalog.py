"""Transform catalog derived from real silver CLEANERS and gold MARTS.

Provides the /layers console with accurate cleaning/aggregation SQL mirrors
(display-only — Spark remains the execution engine) and DQ rule metadata.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from quickcart.lakehouse.gold.marts import MARTS
from quickcart.lakehouse.silver.transforms import (
    CLEANERS,
    DELIVERY_STATUSES,
    MOVEMENT_TYPES,
    ORDER_STATUSES,
    PAYMENT_STATUSES,
    SILVER_TABLE,
)

MedallionLayer = Literal["raw", "bronze", "silver", "quarantine", "gold"]
Engine = Literal["pyspark", "python", "sql", "cdc", "stream", "ml"]


@dataclass(frozen=True)
class TransformRule:
    rule_id: str
    severity: str
    sql_predicate: str
    message: str


@dataclass
class TransformOp:
    id: str
    layer: MedallionLayer
    name: str
    engine: Engine
    summary: str
    code: str
    inputs: list[str]
    outputs: list[str]
    rules: list[TransformRule] = field(default_factory=list)
    impact: dict[str, Any] = field(default_factory=dict)


def _sql_enum(values: list[str]) -> str:
    return ", ".join(f"'{v}'" for v in values)


def _silver_specs() -> dict[str, dict[str, Any]]:
    return {
        "bronze_stores": {
            "dedupe_key": "store_id",
            "order_by": "updated_at",
            "rules": [
                ("DQ-STORE-001", "store_id IS NOT NULL", "store_id is null"),
                ("DQ-STORE-002", "store_code IS NOT NULL", "store_code is null"),
                ("DQ-STORE-003", "city IS NOT NULL", "city is null"),
            ],
        },
        "bronze_customers": {
            "dedupe_key": "customer_id",
            "order_by": "updated_at",
            "rules": [
                ("DQ-CUST-001", "customer_id IS NOT NULL", "customer_id is null"),
                ("DQ-CUST-002", "customer_code IS NOT NULL", "customer_code is null"),
            ],
        },
        "bronze_products": {
            "dedupe_key": "product_id",
            "order_by": "updated_at",
            "rules": [
                ("DQ-PROD-002", "product_id IS NOT NULL", "product_id is null"),
                ("DQ-PROD-001", "sku IS NOT NULL", "sku is null"),
                ("DQ-PROD-003", "category IS NOT NULL", "category is null"),
            ],
        },
        "bronze_riders": {
            "dedupe_key": "rider_id",
            "order_by": "updated_at",
            "rules": [
                ("DQ-RID-001", "rider_id IS NOT NULL", "rider_id is null"),
                ("DQ-RID-002", "home_store_id IS NOT NULL", "home_store_id is null"),
            ],
        },
        "bronze_inventory": {
            "dedupe_key": "store_id, product_id",
            "order_by": "updated_at",
            "rules": [
                (
                    "DQ-INV-001",
                    "on_hand_qty >= 0 AND reserved_qty >= 0 AND reorder_point >= 0",
                    "inventory quantity below zero",
                ),
            ],
        },
        "bronze_orders": {
            "dedupe_key": "order_id",
            "order_by": "updated_at",
            "rules": [
                ("DQ-ORDER-001", "order_id IS NOT NULL", "order_id is null"),
                ("DQ-ORDER-002", "store_id IS NOT NULL", "store_id is null"),
                ("DQ-ORDER-003", "customer_id IS NOT NULL", "customer_id is null"),
                ("DQ-ORDER-006", "placed_at IS NOT NULL", "placed_at is null"),
                ("DQ-ORDER-004", "total_amount >= 0", "total_amount is negative"),
                (
                    "DQ-ORDER-005",
                    f"status IN ({_sql_enum(ORDER_STATUSES)})",
                    "status not in enum",
                ),
            ],
        },
        "bronze_order_items": {
            "dedupe_key": "order_item_id",
            "order_by": "created_at",
            "rules": [
                ("DQ-ITEM-003", "order_item_id IS NOT NULL", "order_item_id is null"),
                ("DQ-ITEM-004", "order_id IS NOT NULL", "order_id is null"),
                ("DQ-ITEM-001", "quantity > 0", "quantity must be > 0"),
                ("DQ-ITEM-006", "unit_price >= 0", "unit_price is negative"),
            ],
        },
        "bronze_payments": {
            "dedupe_key": "payment_id",
            "order_by": "updated_at",
            "rules": [
                ("DQ-PAY-002", "payment_id IS NOT NULL", "payment_id is null"),
                ("DQ-PAY-003", "order_id IS NOT NULL", "order_id is null"),
                ("DQ-PAY-001", "amount >= 0", "amount is negative"),
                (
                    "DQ-PAY-004",
                    f"status IN ({_sql_enum(PAYMENT_STATUSES)})",
                    "status not in enum",
                ),
            ],
        },
        "bronze_deliveries": {
            "dedupe_key": "delivery_id",
            "order_by": "updated_at",
            "rules": [
                ("DQ-DEL-002", "delivery_id IS NOT NULL", "delivery_id is null"),
                ("DQ-DEL-003", "order_id IS NOT NULL", "order_id is null"),
                (
                    "DQ-DEL-004",
                    "picked_up_at IS NULL OR assigned_at IS NULL "
                    "OR picked_up_at >= assigned_at",
                    "picked_up_at before assigned_at",
                ),
                (
                    "DQ-DEL-001",
                    "delivered_at IS NULL OR picked_up_at IS NULL "
                    "OR delivered_at >= picked_up_at",
                    "delivered_at before picked_up_at",
                ),
                (
                    "DQ-DEL-005",
                    f"status IN ({_sql_enum(DELIVERY_STATUSES)})",
                    "status not in enum",
                ),
            ],
        },
        "bronze_inventory_movements": {
            "dedupe_key": "movement_id",
            "order_by": "occurred_at",
            "rules": [
                ("DQ-MOV-002", "movement_id IS NOT NULL", "movement_id is null"),
                ("DQ-MOV-001", "quantity_delta <> 0", "quantity_delta is zero"),
                (
                    "DQ-MOV-003",
                    f"movement_type IN ({_sql_enum(MOVEMENT_TYPES)})",
                    "movement_type not in enum",
                ),
            ],
        },
    }


def _silver_sql(bronze: str, silver: str, quarantine: str, spec: dict[str, Any]) -> str:
    lines = [f"  AND {pred}  -- {rid}" for rid, pred, _msg in spec["rules"]]
    where = "\n".join(lines).replace("  AND ", "WHERE ", 1)
    keys = [k.strip() for k in str(spec["dedupe_key"]).split(",")]
    partition = ", ".join(keys)
    return (
        f"-- {silver} ← {bronze}  (PySpark cleaner; SQL mirror for the console)\n"
        f"-- Rejects → quarantine/{quarantine} (_error_codes, _error_messages)\n"
        f"SELECT *\n"
        f"FROM {bronze}\n"
        f"{where}\n"
        f"QUALIFY ROW_NUMBER() OVER (\n"
        f"  PARTITION BY {partition}\n"
        f"  ORDER BY {spec['order_by']} DESC\n"
        f") = 1;\n"
    )


def _silver_ops() -> list[TransformOp]:
    specs = _silver_specs()
    ops: list[TransformOp] = []
    for bronze in CLEANERS:
        silver = SILVER_TABLE[bronze]
        entity = bronze.removeprefix("bronze_")
        quarantine = f"{silver}_quarantine"
        spec = specs[bronze]
        rules = [
            TransformRule(rid, "error", pred, msg) for rid, pred, msg in spec["rules"]
        ]
        ops.append(
            TransformOp(
                id=f"silver-clean-{entity}",
                layer="silver",
                name=f"clean_{entity}",
                engine="pyspark",
                summary=(
                    f"Apply DQ rules from kit/04 on {bronze}, quarantine rejects, "
                    f"dedupe to {silver}."
                ),
                code=_silver_sql(bronze, silver, quarantine, spec),
                inputs=[f"bronze.{bronze}"],
                outputs=[f"silver.{silver}", f"quarantine.{quarantine}"],
                rules=rules,
                impact={
                    "rows_in": 50_000,
                    "rows_out": 48_500,
                    "rows_quarantined": 1_500,
                    "columns_added": ["_error_codes", "_error_messages", "_quarantined_at"],
                    "quality_lift_pct": 3.0,
                    "latency_ms": 2_400,
                },
            )
        )
    return ops


_GOLD_SQL: dict[str, tuple[list[str], str, str]] = {
    "gold_store_hourly_metrics": (
        [
            "silver.silver_orders",
            "silver.silver_deliveries",
            "silver.silver_payments",
            "silver.silver_riders",
        ],
        "Hourly store KPIs: orders, GMV, cancel rate, payment fail, late deliveries.",
        """-- gold_store_hourly_metrics ← silver_orders + deliveries + payments + riders
SELECT
  o.store_id,
  date_trunc('hour', o.placed_at) AS metric_hour,
  COUNT(*) AS orders,
  SUM(o.total_amount) AS gmv,
  AVG(CASE WHEN o.status = 'CANCELLED' THEN 1.0 ELSE 0.0 END) AS cancel_rate,
  AVG(CASE WHEN p.status = 'FAILED' THEN 1.0 ELSE 0.0 END) AS payment_fail_rate,
  AVG(CASE
        WHEN d.delivered_at IS NOT NULL AND d.promised_by IS NOT NULL
         AND d.delivered_at > d.promised_by THEN 1.0
        ELSE 0.0
      END) AS late_rate
FROM silver_orders o
LEFT JOIN silver_payments p ON p.order_id = o.order_id
LEFT JOIN silver_deliveries d ON d.order_id = o.order_id
GROUP BY o.store_id, date_trunc('hour', o.placed_at);
""",
    ),
    "gold_customer_360": (
        ["silver.silver_orders", "silver.silver_order_items", "silver.silver_products"],
        "Customer lifetime orders/GMV and favourite category from order lines.",
        """-- gold_customer_360 ← silver_orders + order_items + products
SELECT
  o.customer_id,
  COUNT(DISTINCT o.order_id) AS lifetime_orders,
  SUM(o.total_amount) AS lifetime_gmv,
  MAX(o.placed_at) AS last_order_at,
  mode() WITHIN GROUP (ORDER BY pr.category) AS favourite_category
FROM silver_orders o
JOIN silver_order_items oi ON oi.order_id = o.order_id
JOIN silver_products pr ON pr.product_id = oi.product_id
WHERE o.status <> 'CANCELLED'
GROUP BY o.customer_id;
""",
    ),
    "gold_inventory_health": (
        ["silver.silver_inventory", "silver.silver_inventory_movements"],
        "On-hand vs reorder point and recent movement velocity per store/SKU.",
        """-- gold_inventory_health ← silver_inventory + inventory_movements
SELECT
  i.store_id,
  i.product_id,
  i.on_hand_qty,
  i.reserved_qty,
  i.reorder_point,
  COALESCE(SUM(CASE WHEN m.quantity_delta < 0 THEN -m.quantity_delta ELSE 0 END), 0)
    AS units_sold_7d,
  CASE
    WHEN i.reorder_point > 0 AND i.on_hand_qty <= i.reorder_point THEN 'AT_RISK'
    ELSE 'HEALTHY'
  END AS stock_status
FROM silver_inventory i
LEFT JOIN silver_inventory_movements m
  ON m.store_id = i.store_id AND m.product_id = i.product_id
 AND m.occurred_at >= now() - INTERVAL '7' DAY
GROUP BY i.store_id, i.product_id, i.on_hand_qty, i.reserved_qty, i.reorder_point;
""",
    ),
    "gold_delivery_performance": (
        [
            "silver.silver_orders",
            "silver.silver_deliveries",
            "silver.silver_store_weather",
        ],
        "Per-store daily late rate joined to silver_store_weather when present.",
        """-- gold_delivery_performance ← silver_orders + deliveries (+ store weather)
SELECT
  o.store_id,
  CAST(o.placed_at AS date) AS day,
  COUNT(*) AS deliveries,
  AVG(CASE
        WHEN d.delivered_at IS NOT NULL AND d.promised_by IS NOT NULL
         AND d.delivered_at > d.promised_by THEN 1.0
        ELSE 0.0
      END) AS late_delivery_rate,
  AVG(o.total_amount) AS avg_order_value,
  w.weather_condition
FROM silver_orders o
JOIN silver_deliveries d ON d.order_id = o.order_id
LEFT JOIN silver_store_weather w
  ON w.store_id = o.store_id
 AND w.weather_hour = date_trunc('hour', o.placed_at)
GROUP BY o.store_id, CAST(o.placed_at AS date), w.weather_condition;
""",
    ),
    "gold_product_performance": (
        ["silver.silver_order_items", "silver.silver_products", "silver.silver_orders"],
        "Daily units sold and revenue by product / category.",
        """-- gold_product_performance ← order_items + products + orders
SELECT
  pr.product_id,
  pr.sku,
  pr.category,
  CAST(o.placed_at AS date) AS day,
  SUM(oi.quantity) AS units_sold,
  SUM(oi.line_total) AS revenue
FROM silver_order_items oi
JOIN silver_orders o ON o.order_id = oi.order_id
JOIN silver_products pr ON pr.product_id = oi.product_id
WHERE o.status <> 'CANCELLED'
GROUP BY pr.product_id, pr.sku, pr.category, CAST(o.placed_at AS date);
""",
    ),
}


def _gold_ops() -> list[TransformOp]:
    ops: list[TransformOp] = []
    for mart_name in MARTS:
        inputs, summary, sql = _GOLD_SQL[mart_name]
        ops.append(
            TransformOp(
                id=f"gold-build-{mart_name.removeprefix('gold_')}",
                layer="gold",
                name=f"build_{mart_name}",
                engine="pyspark",
                summary=summary,
                code=sql.strip() + "\n",
                inputs=inputs,
                outputs=[f"gold.{mart_name}"],
                impact={
                    "rows_in": 120_000,
                    "rows_out": 8_400,
                    "rows_quarantined": 0,
                    "latency_ms": 5_200,
                },
            )
        )
    return ops


_BRONZE_OPS: list[TransformOp] = [
    TransformOp(
        id="bronze-cdc-orders",
        layer="bronze",
        name="cdc_orders_ingest",
        engine="cdc",
        summary="Debezium CDC from postgres.public.orders → bronze_orders_cdc (append-only).",
        code=(
            "-- bronze_orders_cdc ← postgres.public.orders (Debezium)\n"
            "INSERT INTO bronze_orders_cdc\n"
            "SELECT *, _op, _lsn, _ingested_at\n"
            "FROM cdc.quickcart.public.orders;\n"
        ),
        inputs=["raw.orders"],
        outputs=["bronze.bronze_orders_cdc"],
        impact={"rows_in": 184_205, "rows_out": 184_205, "latency_ms": 420},
    ),
    TransformOp(
        id="bronze-batch-orders",
        layer="bronze",
        name="batch_orders_snapshot",
        engine="pyspark",
        summary="Batch export of operational orders into bronze_orders.",
        code=(
            "-- bronze_orders ← postgres.public.orders (batch export)\n"
            "INSERT OVERWRITE bronze_orders\n"
            "SELECT *, current_date() AS _ingestion_date\n"
            "FROM jdbc_postgres.public.orders;\n"
        ),
        inputs=["raw.orders"],
        outputs=["bronze.bronze_orders"],
        impact={"rows_in": 96_000, "rows_out": 96_000, "latency_ms": 3_100},
    ),
    TransformOp(
        id="bronze-batch-inventory",
        layer="bronze",
        name="batch_inventory_snapshot",
        engine="pyspark",
        summary="Snapshot inventory into bronze_inventory for silver DQ.",
        code=(
            "-- bronze_inventory ← postgres.public.inventory\n"
            "INSERT OVERWRITE bronze_inventory\n"
            "SELECT store_id, product_id, on_hand_qty, reserved_qty, reorder_point,\n"
            "       updated_at, current_date() AS _ingestion_date\n"
            "FROM jdbc_postgres.public.inventory;\n"
        ),
        inputs=["raw.inventory"],
        outputs=["bronze.bronze_inventory"],
        impact={"rows_in": 20_000, "rows_out": 20_000, "latency_ms": 1_800},
    ),
    TransformOp(
        id="bronze-weather-feed",
        layer="bronze",
        name="ingest_weather_open_meteo",
        engine="python",
        summary="Open-Meteo weather for store cities → bronze_weather_feed.",
        code=(
            "-- bronze_weather_feed ← Open-Meteo (raw/weather JSONL → Delta)\n"
            "INSERT INTO bronze_weather_feed\n"
            "SELECT store_id, city, observed_at, temp_c, precip_mm, condition,\n"
            "       current_date() AS _ingestion_date\n"
            "FROM read_json('data/raw/weather/load_date=*/weather.json');\n"
        ),
        inputs=["raw.weather_feed"],
        outputs=["bronze.bronze_weather_feed"],
        impact={"rows_in": 240, "rows_out": 240, "latency_ms": 900},
    ),
    TransformOp(
        id="bronze-news-feed",
        layer="bronze",
        name="ingest_news_rss",
        engine="python",
        summary="City Google News RSS → bronze_news_feed.",
        code=(
            "-- bronze_news_feed ← city RSS (raw/news JSONL → Delta)\n"
            "INSERT INTO bronze_news_feed\n"
            "SELECT article_id, city, published_at, headline, source,\n"
            "       current_date() AS _ingestion_date\n"
            "FROM read_json('data/raw/news/load_date=*/news.json');\n"
        ),
        inputs=["raw.news_feed"],
        outputs=["bronze.bronze_news_feed"],
        impact={"rows_in": 120, "rows_out": 120, "latency_ms": 1_200},
    ),
    TransformOp(
        id="bronze-traffic-feed",
        layer="bronze",
        name="ingest_traffic_osrm",
        engine="python",
        summary="OSRM / rush-hour ETA delays → bronze_traffic_feed.",
        code=(
            "-- bronze_traffic_feed ← OSRM / rush-hour model\n"
            "INSERT INTO bronze_traffic_feed\n"
            "SELECT store_id, city, observed_at, eta_delay_sec, baseline_eta_sec,\n"
            "       current_date() AS _ingestion_date\n"
            "FROM read_json('data/raw/traffic/load_date=*/traffic.json');\n"
        ),
        inputs=["raw.traffic_feed"],
        outputs=["bronze.bronze_traffic_feed"],
        impact={"rows_in": 10, "rows_out": 10, "latency_ms": 700},
    ),
]


def _quarantine_ops() -> list[TransformOp]:
    ops: list[TransformOp] = []
    for bronze in CLEANERS:
        silver = SILVER_TABLE[bronze]
        entity = bronze.removeprefix("bronze_")
        quarantine = f"{silver}_quarantine"
        ops.append(
            TransformOp(
                id=f"quarantine-{entity}",
                layer="quarantine",
                name=f"retain_{entity}_rejects",
                engine="pyspark",
                summary=(
                    f"Rows failing clean_{entity} DQ rules are retained in "
                    f"{quarantine} with structured _error_codes — never dropped."
                ),
                code=(
                    f"-- quarantine/{quarantine} ← rejects from clean_{entity}\n"
                    f"-- Written by apply_rules() in quickcart.quality\n"
                    f"SELECT *,\n"
                    f"       _error_codes,\n"
                    f"       _error_messages,\n"
                    f"       _quarantined_at\n"
                    f"FROM {bronze}\n"
                    f"WHERE NOT (/* all DQ predicates for {entity} */);\n"
                ),
                inputs=[f"bronze.{bronze}"],
                outputs=[f"quarantine.{quarantine}"],
                impact={
                    "rows_in": 1_500,
                    "rows_out": 1_500,
                    "rows_quarantined": 1_500,
                    "columns_added": ["_error_codes", "_error_messages", "_quarantined_at"],
                    "latency_ms": 200,
                },
            )
        )
    return ops


def all_transform_ops() -> list[TransformOp]:
    return [*_BRONZE_OPS, *_silver_ops(), *_quarantine_ops(), *_gold_ops()]


def ops_for_table(table: str) -> list[TransformOp]:
    bare = table.split(".")[-1].lower()
    matched: list[TransformOp] = []
    for op in all_transform_ops():
        names = " ".join(op.inputs + op.outputs).lower()
        if bare in names or op.id == table:
            matched.append(op)
    return matched


def get_op(op_id: str) -> TransformOp | None:
    for op in all_transform_ops():
        if op.id == op_id:
            return op
    return None


__all__ = [
    "TransformOp",
    "TransformRule",
    "all_transform_ops",
    "get_op",
    "ops_for_table",
]
