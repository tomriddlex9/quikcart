"""Silver transforms (kit/03 §4.3): trusted entities from Bronze.

Pure DataFrame→(clean, quarantine) pairs (kit/05 §4.3): no I/O, no paths —
the loader in `silver/load.py` owns writes. Every rejected row keeps its
original payload plus structured error fields (kit/05 §10). Rule IDs follow
the catalog in `kit/04 §11`; the reusable rule engine generalises this in
Phase 5 — here the Phase 4 MVP implements the null/uniqueness/enum/range
subset:

- DQ-ORDER-001 order_id not null        - DQ-ORDER-004 total_amount >= 0
- DQ-ORDER-005 status allowed           - DQ-ITEM-001  quantity > 0
- DQ-PAY-001  amount >= 0               - DQ-DEL-001   delivered_at >= picked_up_at
- DQ-CUST-001 customer_id not null      - DQ-PROD-001  sku not null
- DQ-INV-001  quantities >= 0           - DQ-MOV-001   quantity_delta != 0

Referential (FK-existence) rules are Phase 5's job, together with SCD2/MERGE.
"""

from pyspark.sql import DataFrame, Window
from pyspark.sql import functions as F

ORDER_STATUSES = [
    "CREATED", "PLACED", "PAYMENT_PENDING", "PAID", "ACCEPTED", "PICKING",
    "PACKED", "RIDER_ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "REFUNDED",
]
PAYMENT_STATUSES = ["INITIATED", "AUTHORIZED", "CAPTURED", "FAILED", "REFUNDED"]
DELIVERY_STATUSES = ["PENDING", "ASSIGNED", "PICKED_UP", "DELIVERED", "CANCELLED"]
MOVEMENT_TYPES = [
    "RECEIPT", "ORDER_RESERVE", "ORDER_RELEASE", "SALE",
    "MANUAL_ADJUSTMENT", "TRANSFER_IN", "TRANSFER_OUT", "DAMAGE",
]

ERROR_CODE = "_error_codes"
ERROR_MESSAGE = "_error_messages"
QUARANTINED_AT = "_quarantined_at"


def _rule(condition, code: str, message: str):
    """Build a rule tuple: condition (ok-side), code, message."""
    return (condition, code, message)


def _apply_rules(df: DataFrame, rules: list) -> tuple[DataFrame, DataFrame]:
    """Split df into (clean, quarantine) by rule conditions.

    A row failing any rule lands in quarantine with all failed codes joined.
    """
    checks = []
    for condition, code, message in rules:
        failed = F.when(
            ~condition, F.struct(F.lit(code).alias("code"), F.lit(message).alias("msg"))
        )
        checks.append(failed)
    flagged = df.select(
        "*",
        F.array_compact(F.array(*checks)).alias("_violations"),
    )
    quarantine = (
        flagged.filter(F.size("_violations") > 0)
        .withColumn(ERROR_CODE, F.concat_ws(";", F.transform("_violations", lambda v: v["code"])))
        .withColumn(
            ERROR_MESSAGE, F.concat_ws(" | ", F.transform("_violations", lambda v: v["msg"]))
        )
        .withColumn(QUARANTINED_AT, F.current_timestamp())
        .drop("_violations")
    )
    clean = flagged.filter(F.size("_violations") == 0).drop("_violations")
    return clean, quarantine


def _dedupe(df: DataFrame, key: str | list[str], order_by: str) -> DataFrame:
    keys = [key] if isinstance(key, str) else key
    window = Window.partitionBy(*keys).orderBy(F.col(order_by).desc(), F.col(keys[0]))
    return df.withColumn("_rn", F.row_number().over(window)).filter("_rn = 1").drop("_rn")


def clean_orders(bronze: DataFrame) -> tuple[DataFrame, DataFrame]:
    rules = [
        _rule(F.col("order_id").isNotNull(), "DQ-ORDER-001", "order_id is null"),
        _rule(F.col("customer_id").isNotNull(), "DQ-ORDER-003", "customer_id is null"),
        _rule(F.col("store_id").isNotNull(), "DQ-ORDER-002", "store_id is null"),
        _rule(F.col("placed_at").isNotNull(), "DQ-ORDER-006", "placed_at is null"),
        _rule(F.col("total_amount") >= 0, "DQ-ORDER-004", "total_amount is negative"),
        _rule(F.col("status").isin(ORDER_STATUSES), "DQ-ORDER-005", "status not in enum"),
    ]
    clean, quarantine = _apply_rules(bronze, rules)
    return _dedupe(clean, "order_id", "updated_at"), quarantine


def clean_order_items(bronze: DataFrame) -> tuple[DataFrame, DataFrame]:
    rules = [
        _rule(F.col("order_item_id").isNotNull(), "DQ-ITEM-003", "order_item_id is null"),
        _rule(F.col("order_id").isNotNull(), "DQ-ITEM-004", "order_id is null"),
        _rule(F.col("product_id").isNotNull(), "DQ-ITEM-005", "product_id is null"),
        _rule(F.col("quantity") > 0, "DQ-ITEM-001", "quantity must be > 0"),
        _rule(F.col("unit_price") >= 0, "DQ-ITEM-006", "unit_price is negative"),
    ]
    clean, quarantine = _apply_rules(bronze, rules)
    return _dedupe(clean, "order_item_id", "created_at"), quarantine


def clean_customers(bronze: DataFrame) -> tuple[DataFrame, DataFrame]:
    rules = [
        _rule(F.col("customer_id").isNotNull(), "DQ-CUST-001", "customer_id is null"),
        _rule(F.col("customer_code").isNotNull(), "DQ-CUST-002", "customer_code is null"),
    ]
    clean, quarantine = _apply_rules(bronze, rules)
    return _dedupe(clean, "customer_id", "updated_at"), quarantine


def clean_products(bronze: DataFrame) -> tuple[DataFrame, DataFrame]:
    rules = [
        _rule(F.col("product_id").isNotNull(), "DQ-PROD-002", "product_id is null"),
        _rule(F.col("sku").isNotNull(), "DQ-PROD-001", "sku is null"),
        _rule(F.col("category").isNotNull(), "DQ-PROD-003", "category is null"),
    ]
    clean, quarantine = _apply_rules(bronze, rules)
    return _dedupe(clean, "product_id", "updated_at"), quarantine


def clean_payments(bronze: DataFrame) -> tuple[DataFrame, DataFrame]:
    rules = [
        _rule(F.col("payment_id").isNotNull(), "DQ-PAY-002", "payment_id is null"),
        _rule(F.col("order_id").isNotNull(), "DQ-PAY-003", "order_id is null"),
        _rule(F.col("amount") >= 0, "DQ-PAY-001", "amount is negative"),
        _rule(F.col("status").isin(PAYMENT_STATUSES), "DQ-PAY-004", "status not in enum"),
    ]
    clean, quarantine = _apply_rules(bronze, rules)
    return _dedupe(clean, "payment_id", "updated_at"), quarantine


def clean_deliveries(bronze: DataFrame) -> tuple[DataFrame, DataFrame]:
    rules = [
        _rule(F.col("delivery_id").isNotNull(), "DQ-DEL-002", "delivery_id is null"),
        _rule(F.col("order_id").isNotNull(), "DQ-DEL-003", "order_id is null"),
        _rule(
            F.col("picked_up_at").isNull()
            | F.col("assigned_at").isNull()
            | (F.col("picked_up_at") >= F.col("assigned_at")),
            "DQ-DEL-004",
            "picked_up_at before assigned_at",
        ),
        _rule(
            F.col("delivered_at").isNull()
            | F.col("picked_up_at").isNull()
            | (F.col("delivered_at") >= F.col("picked_up_at")),
            "DQ-DEL-001",
            "delivered_at before picked_up_at",
        ),
        _rule(F.col("status").isin(DELIVERY_STATUSES), "DQ-DEL-005", "status not in enum"),
    ]
    clean, quarantine = _apply_rules(bronze, rules)
    return _dedupe(clean, "delivery_id", "updated_at"), quarantine


def clean_riders(bronze: DataFrame) -> tuple[DataFrame, DataFrame]:
    rules = [
        _rule(F.col("rider_id").isNotNull(), "DQ-RID-001", "rider_id is null"),
        _rule(F.col("home_store_id").isNotNull(), "DQ-RID-002", "home_store_id is null"),
    ]
    clean, quarantine = _apply_rules(bronze, rules)
    return _dedupe(clean, "rider_id", "updated_at"), quarantine


def clean_inventory(bronze: DataFrame) -> tuple[DataFrame, DataFrame]:
    rules = [
        _rule(
            (F.col("on_hand_qty") >= 0)
            & (F.col("reserved_qty") >= 0)
            & (F.col("reorder_point") >= 0),
            "DQ-INV-001",
            "inventory quantity below zero",
        )
    ]
    clean, quarantine = _apply_rules(bronze, rules)
    return _dedupe(clean, ["store_id", "product_id"], "updated_at"), quarantine


def clean_inventory_movements(bronze: DataFrame) -> tuple[DataFrame, DataFrame]:
    rules = [
        _rule(F.col("movement_id").isNotNull(), "DQ-MOV-002", "movement_id is null"),
        _rule(F.col("quantity_delta") != 0, "DQ-MOV-001", "quantity_delta is zero"),
        _rule(
            F.col("movement_type").isin(MOVEMENT_TYPES),
            "DQ-MOV-003",
            "movement_type not in enum",
        ),
    ]
    clean, quarantine = _apply_rules(bronze, rules)
    return _dedupe(clean, "movement_id", "occurred_at"), quarantine


CLEANERS = {
    "bronze_orders": clean_orders,
    "bronze_order_items": clean_order_items,
    "bronze_customers": clean_customers,
    "bronze_products": clean_products,
    "bronze_payments": clean_payments,
    "bronze_deliveries": clean_deliveries,
    "bronze_riders": clean_riders,
    "bronze_inventory": clean_inventory,
    "bronze_inventory_movements": clean_inventory_movements,
}

SILVER_TABLE = {bronze: "silver_" + bronze.removeprefix("bronze_") for bronze in CLEANERS}
