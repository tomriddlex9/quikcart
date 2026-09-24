"""Canonical explicit schemas for raw CSV sources (promoted from Phase 3).

These StructType contracts are the layer boundary between the PostgreSQL
exporter and the lakehouse: money is DecimalType, timestamps are
TimestampType (UTC-naive strings from the exporter), and every column's
nullability is declared.
"""

from pyspark.sql.types import (
    BooleanType,
    DecimalType,
    IntegerType,
    LongType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)

ORDERS_SCHEMA = StructType(
    [
        StructField("order_id", LongType(), False),
        StructField("customer_id", LongType(), False),
        StructField("store_id", LongType(), False),
        StructField("address_id", LongType(), True),
        StructField("promotion_id", LongType(), True),
        StructField("status", StringType(), False),
        StructField("subtotal", DecimalType(12, 2), False),
        StructField("item_discount", DecimalType(12, 2), False),
        StructField("promo_discount", DecimalType(12, 2), False),
        StructField("delivery_fee", DecimalType(12, 2), False),
        StructField("tax_amount", DecimalType(12, 2), False),
        StructField("total_amount", DecimalType(12, 2), False),
        StructField("currency", StringType(), False),
        StructField("placed_at", TimestampType(), False),
        StructField("updated_at", TimestampType(), False),
    ]
)

DELIVERIES_SCHEMA = StructType(
    [
        StructField("delivery_id", LongType(), False),
        StructField("order_id", LongType(), False),
        StructField("rider_id", LongType(), True),
        StructField("promised_by", TimestampType(), False),
        StructField("assigned_at", TimestampType(), True),
        StructField("picked_up_at", TimestampType(), True),
        StructField("delivered_at", TimestampType(), True),
        StructField("cancelled_at", TimestampType(), True),
        StructField("estimated_distance_km", DecimalType(6, 2), False),
        StructField("status", StringType(), False),
        StructField("created_at", TimestampType(), False),
        StructField("updated_at", TimestampType(), False),
    ]
)

ORDER_ITEMS_SCHEMA = StructType(
    [
        StructField("order_item_id", LongType(), False),
        StructField("order_id", LongType(), False),
        StructField("product_id", LongType(), False),
        StructField("quantity", IntegerType(), False),
        StructField("unit_price", DecimalType(12, 2), False),
        StructField("line_discount", DecimalType(12, 2), False),
        StructField("line_total", DecimalType(12, 2), False),
        StructField("created_at", TimestampType(), False),
    ]
)

PRODUCTS_SCHEMA = StructType(
    [
        StructField("product_id", LongType(), False),
        StructField("sku", StringType(), False),
        StructField("name", StringType(), False),
        StructField("category", StringType(), False),
        StructField("subcategory", StringType(), False),
        StructField("brand", StringType(), False),
        StructField("unit_size", DecimalType(10, 3), False),
        StructField("unit_name", StringType(), False),
        StructField("is_active", BooleanType(), False),
        StructField("created_at", TimestampType(), False),
        StructField("updated_at", TimestampType(), False),
    ]
)

CUSTOMERS_SCHEMA = StructType(
    [
        StructField("customer_id", LongType(), False),
        StructField("customer_code", StringType(), False),
        StructField("created_at", TimestampType(), False),
        StructField("updated_at", TimestampType(), False),
        StructField("is_active", BooleanType(), False),
    ]
)

PAYMENTS_SCHEMA = StructType(
    [
        StructField("payment_id", LongType(), False),
        StructField("order_id", LongType(), False),
        StructField("payment_method", StringType(), False),
        StructField("status", StringType(), False),
        StructField("amount", DecimalType(12, 2), False),
        StructField("currency", StringType(), False),
        StructField("attempt_number", IntegerType(), False),
        StructField("failure_code", StringType(), True),
        StructField("created_at", TimestampType(), False),
        StructField("updated_at", TimestampType(), False),
    ]
)

RIDERS_SCHEMA = StructType(
    [
        StructField("rider_id", LongType(), False),
        StructField("home_store_id", LongType(), False),
        StructField("status", StringType(), False),
        StructField("shift_start", StringType(), False),
        StructField("shift_end", StringType(), False),
        StructField("created_at", TimestampType(), False),
        StructField("updated_at", TimestampType(), False),
    ]
)

INVENTORY_SCHEMA = StructType(
    [
        StructField("store_id", LongType(), False),
        StructField("product_id", LongType(), False),
        StructField("on_hand_qty", IntegerType(), False),
        StructField("reserved_qty", IntegerType(), False),
        StructField("reorder_point", IntegerType(), False),
        StructField("updated_at", TimestampType(), False),
    ]
)

INVENTORY_MOVEMENTS_SCHEMA = StructType(
    [
        StructField("movement_id", LongType(), False),
        StructField("store_id", LongType(), False),
        StructField("product_id", LongType(), False),
        StructField("movement_type", StringType(), False),
        StructField("quantity_delta", IntegerType(), False),
        StructField("reference_type", StringType(), True),
        StructField("reference_id", StringType(), True),
        StructField("occurred_at", TimestampType(), False),
        StructField("created_at", TimestampType(), False),
    ]
)

STORES_SCHEMA = StructType(
    [
        StructField("store_id", LongType(), False),
        StructField("store_code", StringType(), False),
        StructField("name", StringType(), False),
        StructField("city", StringType(), False),
        StructField("latitude", DecimalType(9, 6), False),
        StructField("longitude", DecimalType(9, 6), False),
        StructField("service_radius_km", DecimalType(5, 2), False),
        StructField("opened_at", TimestampType(), False),
        StructField("is_active", BooleanType(), False),
        StructField("created_at", TimestampType(), False),
        StructField("updated_at", TimestampType(), False),
    ]
)

BRONZE_METADATA_SCHEMA_PARTS = [
    StructField("_ingested_at", TimestampType(), False),
    StructField("_source_system", StringType(), False),
    StructField("_source_file", StringType(), False),
    StructField("_schema_version", IntegerType(), False),
    StructField("_ingestion_date", StringType(), False),
]
