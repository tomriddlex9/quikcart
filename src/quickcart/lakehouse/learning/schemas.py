"""Explicit schemas for learning/demo sources.

CSV table schemas live canonically in
:mod:`quickcart.lakehouse.common.schemas`; the JSON event envelope is
specific to the demo/learning path and stays here.
"""

from pyspark.sql.types import (
    DecimalType,
    IntegerType,
    LongType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)

from quickcart.lakehouse.common.schemas import (  # noqa: F401  (re-export)
    CUSTOMERS_SCHEMA,
    DELIVERIES_SCHEMA,
    INVENTORY_MOVEMENTS_SCHEMA,
    INVENTORY_SCHEMA,
    ORDER_ITEMS_SCHEMA,
    ORDERS_SCHEMA,
    PAYMENTS_SCHEMA,
    PRODUCTS_SCHEMA,
    RIDERS_SCHEMA,
)

ORDER_EVENTS_SCHEMA = StructType(
    [
        StructField("event_id", StringType(), False),
        StructField("event_type", StringType(), False),
        StructField("schema_version", IntegerType(), False),
        StructField("event_time", TimestampType(), False),
        StructField("producer", StringType(), False),
        StructField("entity_type", StringType(), False),
        StructField("entity_id", StringType(), False),
        StructField("store_id", LongType(), False),
        StructField(
            "payload",
            StructType(
                [
                    StructField("order_id", LongType(), True),
                    StructField("customer_id", LongType(), True),
                    StructField("store_id", LongType(), True),
                    StructField("subtotal", DecimalType(12, 2), True),
                    StructField("discount", DecimalType(12, 2), True),
                    StructField("total_amount", DecimalType(12, 2), True),
                    StructField("currency", StringType(), True),
                    StructField("payment_id", LongType(), True),
                    StructField("amount", DecimalType(12, 2), True),
                    StructField("method", StringType(), True),
                    StructField("attempt_number", IntegerType(), True),
                    StructField("failure_code", StringType(), True),
                    StructField("delivery_id", LongType(), True),
                    StructField("rider_id", LongType(), True),
                    StructField("promised_by", StringType(), True),
                    StructField("delivered_at", StringType(), True),
                    StructField("reason", StringType(), True),
                ]
            ),
            False,
        ),
    ]
)
