"""Static medallion lineage map (raw → bronze → silver/quarantine → gold).

Live row counts are filled in by the API; this module only owns topology.
"""

from __future__ import annotations

from quickcart.live.contracts import LineageEdge, LineageNode

# Column lists are intentionally short showcase sets, not full schemas.
_RAW_COLUMNS: dict[str, list[str]] = {
    "stores": ["store_id", "store_code", "city", "is_active"],
    "customers": ["customer_id", "customer_code", "is_active"],
    "products": ["product_id", "sku", "category", "brand"],
    "inventory": ["store_id", "product_id", "on_hand_qty", "reorder_point"],
    "orders": ["order_id", "store_id", "customer_id", "status", "total_amount", "placed_at"],
    "order_items": ["order_item_id", "order_id", "product_id", "quantity", "line_total"],
    "payments": ["payment_id", "order_id", "amount", "status", "method"],
    "deliveries": ["delivery_id", "order_id", "rider_id", "promised_by", "delivered_at"],
    "riders": ["rider_id", "home_store_id", "status"],
    "pipeline_status": ["stage", "last_run_at", "rows_in", "rows_out", "lag_seconds", "error"],
    "weather_feed": ["city", "observed_at", "temp_c", "precip_mm", "condition"],
    "news_feed": ["article_id", "city", "published_at", "headline", "sentiment"],
    "rider_locations": ["rider_id", "event_time", "lat", "lng"],
    "inventory_updates": ["store_id", "sku", "on_hand_qty", "updated_at"],
    "support_tickets": ["ticket_id", "customer_id", "order_id", "category", "priority", "status"],
    "escalations": ["escalation_id", "ticket_id", "escalated_at", "reason"],
}

_BRONZE = {
    "bronze_orders": ["order_id", "status", "total_amount", "_ingestion_date"],
    "bronze_customers": ["customer_id", "customer_code", "_ingestion_date"],
    "bronze_products": ["product_id", "sku", "_ingestion_date"],
    "bronze_inventory": ["store_id", "product_id", "on_hand_qty", "_ingestion_date"],
    "bronze_deliveries": ["delivery_id", "order_id", "_ingestion_date"],
    "bronze_order_events": ["event_id", "event_type", "entity_id", "event_time", "_offset"],
    "bronze_orders_cdc": ["order_id", "op", "lsn", "_ingested_at"],
    "bronze_inventory_cdc": ["store_id", "product_id", "op", "_ingested_at"],
    "bronze_payments_cdc": ["payment_id", "op", "_ingested_at"],
    "bronze_order_items_cdc": ["order_item_id", "op", "_ingested_at"],
    "bronze_deliveries_cdc": ["delivery_id", "op", "_ingested_at"],
    "bronze_weather_feed": ["city", "observed_at", "temp_c", "precip_mm", "_ingestion_date"],
    "bronze_news_feed": ["article_id", "city", "published_at", "headline", "_ingestion_date"],
    "bronze_rider_locations": ["rider_id", "event_time", "lat", "lng", "_kafka_offset"],
    "bronze_inventory_updates": ["store_id", "sku", "on_hand_qty", "_ingestion_date"],
    "bronze_support_tickets": ["ticket_id", "order_id", "priority_raw", "_ingestion_date"],
    "bronze_escalations": ["escalation_id", "ticket_id", "escalated_at", "_ingestion_date"],
}

_SILVER = {
    "silver_orders": ["order_id", "store_id", "status", "total_amount", "placed_at"],
    "silver_customers": ["customer_id", "customer_code", "is_active"],
    "silver_products": ["product_id", "sku", "category"],
    "silver_inventory": ["store_id", "product_id", "on_hand_qty"],
    "silver_deliveries": ["delivery_id", "order_id", "promised_by", "delivered_at"],
    "silver_city_hour_context": ["city", "hour", "temp_c", "precip_mm", "news_volume"],
    "silver_rider_locations": ["rider_id", "hour_window", "lat", "lng"],
    "silver_support_tickets": ["ticket_id", "order_id", "store_id", "priority", "escalated"],
}

_QUARANTINE = {
    "quarantine_orders": ["order_id", "_reject_reason", "_ingestion_date"],
    "quarantine_bronze_order_events_malformed": ["_json", "_topic", "_offset"],
}

_GOLD = {
    "gold_store_hourly_metrics": ["store_id", "metric_hour", "orders", "gmv"],
    "gold_customer_360": ["customer_id", "lifetime_orders", "lifetime_gmv"],
    "gold_inventory_health": ["store_id", "product_id", "stock_cover_hours"],
    "gold_delivery_performance": ["store_id", "day", "late_rate"],
    "gold_product_performance": ["product_id", "day", "units_sold"],
    "gold_delivery_predictions": ["order_id", "late_probability", "predicted_class"],
    "gold_demand_forecasts": ["store_id", "category", "forecast_date", "expected_units"],
    "gold_anomalies": ["anomaly_type", "store_id", "observed_on", "severity"],
    "gold_support_escalation_metrics": [
        "store_id",
        "day",
        "tickets",
        "escalation_rate",
        "mttr_seconds",
    ],
}

_EDGES: list[tuple[str, str, str]] = [
    # raw → bronze (batch export)
    ("raw.orders", "bronze.bronze_orders", "batch"),
    ("raw.customers", "bronze.bronze_customers", "batch"),
    ("raw.products", "bronze.bronze_products", "batch"),
    ("raw.inventory", "bronze.bronze_inventory", "batch"),
    ("raw.deliveries", "bronze.bronze_deliveries", "batch"),
    # stream / cdc
    ("raw.orders", "bronze.bronze_orders_cdc", "cdc"),
    ("raw.inventory", "bronze.bronze_inventory_cdc", "cdc"),
    ("raw.payments", "bronze.bronze_payments_cdc", "cdc"),
    ("raw.order_items", "bronze.bronze_order_items_cdc", "cdc"),
    ("raw.deliveries", "bronze.bronze_deliveries_cdc", "cdc"),
    ("bronze.bronze_order_events", "bronze.bronze_order_events", "stream"),
    # bronze → silver / quarantine
    ("bronze.bronze_orders", "silver.silver_orders", "batch"),
    ("bronze.bronze_orders", "quarantine.quarantine_orders", "batch"),
    ("bronze.bronze_customers", "silver.silver_customers", "batch"),
    ("bronze.bronze_products", "silver.silver_products", "batch"),
    ("bronze.bronze_inventory", "silver.silver_inventory", "batch"),
    ("bronze.bronze_deliveries", "silver.silver_deliveries", "batch"),
    ("bronze.bronze_orders_cdc", "silver.silver_orders", "cdc"),
    ("bronze.bronze_order_events", "quarantine.quarantine_bronze_order_events_malformed", "stream"),
    # silver → gold
    ("silver.silver_orders", "gold.gold_store_hourly_metrics", "batch"),
    ("silver.silver_orders", "gold.gold_customer_360", "batch"),
    ("silver.silver_orders", "gold.gold_product_performance", "batch"),
    ("silver.silver_inventory", "gold.gold_inventory_health", "batch"),
    ("silver.silver_deliveries", "gold.gold_delivery_performance", "batch"),
    ("silver.silver_orders", "gold.gold_delivery_predictions", "ml"),
    ("silver.silver_orders", "gold.gold_demand_forecasts", "ml"),
    ("gold.gold_store_hourly_metrics", "gold.gold_anomalies", "ml"),
    # weather / news / rider-locations / inventory-updates / support / escalations
    ("raw.weather_feed", "bronze.bronze_weather_feed", "batch"),
    ("raw.news_feed", "bronze.bronze_news_feed", "batch"),
    ("raw.rider_locations", "bronze.bronze_rider_locations", "stream"),
    ("raw.inventory_updates", "bronze.bronze_inventory_updates", "batch"),
    ("raw.support_tickets", "bronze.bronze_support_tickets", "batch"),
    ("raw.escalations", "bronze.bronze_escalations", "batch"),
    ("bronze.bronze_weather_feed", "silver.silver_city_hour_context", "batch"),
    ("bronze.bronze_news_feed", "silver.silver_city_hour_context", "batch"),
    ("bronze.bronze_rider_locations", "silver.silver_rider_locations", "stream"),
    ("bronze.bronze_inventory_updates", "silver.silver_inventory", "batch"),
    ("bronze.bronze_support_tickets", "silver.silver_support_tickets", "batch"),
    ("bronze.bronze_escalations", "silver.silver_support_tickets", "batch"),
    ("silver.silver_support_tickets", "gold.gold_support_escalation_metrics", "batch"),
    ("silver.silver_rider_locations", "gold.gold_delivery_predictions", "ml"),
    ("silver.silver_city_hour_context", "gold.gold_demand_forecasts", "ml"),
]


def lineage_nodes() -> list[LineageNode]:
    nodes: list[LineageNode] = []
    for name, cols in _RAW_COLUMNS.items():
        nodes.append(LineageNode(id=f"raw.{name}", layer="raw", name=name, columns=cols))
    for name, cols in _BRONZE.items():
        nodes.append(LineageNode(id=f"bronze.{name}", layer="bronze", name=name, columns=cols))
    for name, cols in _SILVER.items():
        nodes.append(LineageNode(id=f"silver.{name}", layer="silver", name=name, columns=cols))
    for name, cols in _QUARANTINE.items():
        nodes.append(
            LineageNode(id=f"quarantine.{name}", layer="quarantine", name=name, columns=cols)
        )
    for name, cols in _GOLD.items():
        nodes.append(LineageNode(id=f"gold.{name}", layer="gold", name=name, columns=cols))
    return nodes


def lineage_edges() -> list[LineageEdge]:
    return [
        LineageEdge(source=src, target=tgt, kind=kind)  # type: ignore[arg-type]
        for src, tgt, kind in _EDGES
    ]
