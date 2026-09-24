"""Silver transforms (kit/03 §4.3/§5.2): trusted entities from Bronze.

Pure DataFrame→(clean, quarantine, summary) transformations built on the
shared rule engine (`quickcart.quality`). Every rejected row keeps its
original payload plus structured error fields (kit/05 §10). Rule IDs follow
`kit/04 §11`; the Phase 4 MVP implemented null/uniqueness/enum/range rules —
Phase 5 adds referential (FK-existence) rules via optional reference frames.
"""

from pyspark.sql import DataFrame, Window
from pyspark.sql import functions as F

from quickcart.quality import Rule, apply_rules

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


def _fk_rule(
    ref: DataFrame | None, key: str, rule_id: str, message: str
) -> Rule | None:
    """FK-existence rule: NULL or unknown keys are invalid (kit/04 §11)."""
    if ref is None:
        return None
    ref_keys = [r[key] for r in ref.select(key).distinct().collect() if r[key] is not None]
    if not ref_keys:
        return Rule(rule_id, "error", F.lit(True), message)
    return Rule(
        rule_id,
        "error",
        F.col(key).isNotNull() & F.col(key).isin(ref_keys),
        message,
    )


def _dedupe(df: DataFrame, key: str | list[str], order_by: str) -> DataFrame:
    keys = [key] if isinstance(key, str) else key
    window = Window.partitionBy(*keys).orderBy(F.col(order_by).desc(), F.col(keys[0]))
    return df.withColumn("_rn", F.row_number().over(window)).filter("_rn = 1").drop("_rn")


def clean_stores(bronze: DataFrame) -> tuple[DataFrame, DataFrame, DataFrame]:
    rules = [
        Rule("DQ-STORE-001", "error", F.col("store_id").isNotNull(), "store_id is null"),
        Rule("DQ-STORE-002", "error", F.col("store_code").isNotNull(), "store_code is null"),
        Rule("DQ-STORE-003", "error", F.col("city").isNotNull(), "city is null"),
    ]
    clean, quarantine, summary = apply_rules(bronze, rules)
    return _dedupe(clean, "store_id", "updated_at"), quarantine, summary


def clean_orders(
    bronze: DataFrame,
    stores: DataFrame | None = None,
    customers: DataFrame | None = None,
) -> tuple[DataFrame, DataFrame, DataFrame]:
    rules = [
        Rule("DQ-ORDER-001", "error", F.col("order_id").isNotNull(), "order_id is null"),
        Rule("DQ-ORDER-002", "error", F.col("store_id").isNotNull(), "store_id is null"),
        Rule("DQ-ORDER-003", "error", F.col("customer_id").isNotNull(), "customer_id is null"),
        Rule("DQ-ORDER-006", "error", F.col("placed_at").isNotNull(), "placed_at is null"),
        Rule("DQ-ORDER-004", "error", F.col("total_amount") >= 0, "total_amount is negative"),
        Rule("DQ-ORDER-005", "error", F.col("status").isin(ORDER_STATUSES), "status not in enum"),
    ]
    fk_store = _fk_rule(stores, "store_id", "DQ-ORDER-002", "store_id does not exist")
    fk_customer = _fk_rule(
        customers, "customer_id", "DQ-ORDER-003", "customer_id does not exist"
    )
    rules.extend(r for r in (fk_store, fk_customer) if r is not None)
    clean, quarantine, summary = apply_rules(bronze, rules)
    return _dedupe(clean, "order_id", "updated_at"), quarantine, summary


def clean_order_items(
    bronze: DataFrame, products: DataFrame | None = None
) -> tuple[DataFrame, DataFrame, DataFrame]:
    rules = [
        Rule("DQ-ITEM-003", "error", F.col("order_item_id").isNotNull(), "order_item_id is null"),
        Rule("DQ-ITEM-004", "error", F.col("order_id").isNotNull(), "order_id is null"),
        Rule("DQ-ITEM-001", "error", F.col("quantity") > 0, "quantity must be > 0"),
        Rule("DQ-ITEM-006", "error", F.col("unit_price") >= 0, "unit_price is negative"),
    ]
    fk_product = _fk_rule(products, "product_id", "DQ-ITEM-002", "product_id does not exist")
    if fk_product is not None:
        rules.append(fk_product)
    clean, quarantine, summary = apply_rules(bronze, rules)
    return _dedupe(clean, "order_item_id", "created_at"), quarantine, summary


def clean_customers(bronze: DataFrame) -> tuple[DataFrame, DataFrame, DataFrame]:
    rules = [
        Rule("DQ-CUST-001", "error", F.col("customer_id").isNotNull(), "customer_id is null"),
        Rule("DQ-CUST-002", "error", F.col("customer_code").isNotNull(), "customer_code is null"),
    ]
    clean, quarantine, summary = apply_rules(bronze, rules)
    return _dedupe(clean, "customer_id", "updated_at"), quarantine, summary


def clean_products(bronze: DataFrame) -> tuple[DataFrame, DataFrame, DataFrame]:
    rules = [
        Rule("DQ-PROD-002", "error", F.col("product_id").isNotNull(), "product_id is null"),
        Rule("DQ-PROD-001", "error", F.col("sku").isNotNull(), "sku is null"),
        Rule("DQ-PROD-003", "error", F.col("category").isNotNull(), "category is null"),
    ]
    clean, quarantine, summary = apply_rules(bronze, rules)
    return _dedupe(clean, "product_id", "updated_at"), quarantine, summary


def clean_payments(bronze: DataFrame) -> tuple[DataFrame, DataFrame, DataFrame]:
    rules = [
        Rule("DQ-PAY-002", "error", F.col("payment_id").isNotNull(), "payment_id is null"),
        Rule("DQ-PAY-003", "error", F.col("order_id").isNotNull(), "order_id is null"),
        Rule("DQ-PAY-001", "error", F.col("amount") >= 0, "amount is negative"),
        Rule("DQ-PAY-004", "error", F.col("status").isin(PAYMENT_STATUSES), "status not in enum"),
    ]
    clean, quarantine, summary = apply_rules(bronze, rules)
    return _dedupe(clean, "payment_id", "updated_at"), quarantine, summary


def clean_deliveries(bronze: DataFrame) -> tuple[DataFrame, DataFrame, DataFrame]:
    rules = [
        Rule("DQ-DEL-002", "error", F.col("delivery_id").isNotNull(), "delivery_id is null"),
        Rule("DQ-DEL-003", "error", F.col("order_id").isNotNull(), "order_id is null"),
        Rule(
            "DQ-DEL-004",
            "error",
            F.col("picked_up_at").isNull()
            | F.col("assigned_at").isNull()
            | (F.col("picked_up_at") >= F.col("assigned_at")),
            "picked_up_at before assigned_at",
        ),
        Rule(
            "DQ-DEL-001",
            "error",
            F.col("delivered_at").isNull()
            | F.col("picked_up_at").isNull()
            | (F.col("delivered_at") >= F.col("picked_up_at")),
            "delivered_at before picked_up_at",
        ),
        Rule("DQ-DEL-005", "error", F.col("status").isin(DELIVERY_STATUSES), "status not in enum"),
    ]
    clean, quarantine, summary = apply_rules(bronze, rules)
    return _dedupe(clean, "delivery_id", "updated_at"), quarantine, summary


def clean_riders(bronze: DataFrame) -> tuple[DataFrame, DataFrame, DataFrame]:
    rules = [
        Rule("DQ-RID-001", "error", F.col("rider_id").isNotNull(), "rider_id is null"),
        Rule("DQ-RID-002", "error", F.col("home_store_id").isNotNull(), "home_store_id is null"),
    ]
    clean, quarantine, summary = apply_rules(bronze, rules)
    return _dedupe(clean, "rider_id", "updated_at"), quarantine, summary


def clean_inventory(bronze: DataFrame) -> tuple[DataFrame, DataFrame, DataFrame]:
    rules = [
        Rule(
            "DQ-INV-001",
            "error",
            (F.col("on_hand_qty") >= 0)
            & (F.col("reserved_qty") >= 0)
            & (F.col("reorder_point") >= 0),
            "inventory quantity below zero",
        )
    ]
    clean, quarantine, summary = apply_rules(bronze, rules)
    return _dedupe(clean, ["store_id", "product_id"], "updated_at"), quarantine, summary


def clean_inventory_movements(bronze: DataFrame) -> tuple[DataFrame, DataFrame, DataFrame]:
    rules = [
        Rule("DQ-MOV-002", "error", F.col("movement_id").isNotNull(), "movement_id is null"),
        Rule("DQ-MOV-001", "error", F.col("quantity_delta") != 0, "quantity_delta is zero"),
        Rule(
            "DQ-MOV-003",
            "error",
            F.col("movement_type").isin(MOVEMENT_TYPES),
            "movement_type not in enum",
        ),
    ]
    clean, quarantine, summary = apply_rules(bronze, rules)
    return _dedupe(clean, "movement_id", "occurred_at"), quarantine, summary


CLEANERS = {
    "bronze_stores": clean_stores,
    "bronze_customers": clean_customers,
    "bronze_products": clean_products,
    "bronze_riders": clean_riders,
    "bronze_inventory": clean_inventory,
    "bronze_orders": clean_orders,
    "bronze_order_items": clean_order_items,
    "bronze_payments": clean_payments,
    "bronze_deliveries": clean_deliveries,
    "bronze_inventory_movements": clean_inventory_movements,
}

SILVER_TABLE = {bronze: "silver_" + bronze.removeprefix("bronze_") for bronze in CLEANERS}

# FK reference providers: silver table -> {argument: silver reference table}
FK_REFS = {
    "bronze_orders": {"stores": "silver_stores", "customers": "silver_customers"},
    "bronze_order_items": {"products": "silver_products"},
}
