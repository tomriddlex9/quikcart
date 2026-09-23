import pytest

from quickcart.db.connection import connect, fetch_all


@pytest.mark.contracts
def test_money_columns_are_numeric(seeded_db) -> None:
    money_columns = {
        "orders": ["subtotal", "item_discount", "promo_discount", "delivery_fee",
                   "tax_amount", "total_amount"],
        "order_items": ["unit_price", "line_discount", "line_total"],
        "payments": ["amount"],
        "product_prices": ["mrp", "selling_price"],
        "promotions": ["value", "min_order_value", "max_discount"],
        "stores": ["service_radius_km"],
        "products": ["unit_size"],
        "deliveries": ["estimated_distance_km"],
    }
    with connect(autocommit=True) as conn:
        rows = fetch_all(
            conn,
            """SELECT table_name, column_name, data_type
               FROM information_schema.columns
               WHERE table_name = ANY(%s)""",
            (list(money_columns),),
        )
    by_table = {(r["table_name"], r["column_name"]): r["data_type"] for r in rows}
    for table, columns in money_columns.items():
        for column in columns:
            assert by_table[(table, column)] == "numeric", f"{table}.{column}"


@pytest.mark.contracts
def test_all_timestamp_columns_are_timestamptz(seeded_db) -> None:
    with connect(autocommit=True) as conn:
        rows = fetch_all(
            conn,
            """SELECT table_name, column_name, data_type
               FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND (column_name ~ '_at$' OR column_name ~ '^valid')""",
        )
    assert rows, "expected timestamp columns to exist"
    for row in rows:
        assert row["data_type"] == "timestamp with time zone", (
            f"{row['table_name']}.{row['column_name']} is {row['data_type']}"
        )


@pytest.mark.contracts
def test_status_columns_have_check_constraints(seeded_db) -> None:
    with connect(autocommit=True) as conn:
        rows = fetch_all(
            conn,
            """SELECT conrelid::regclass::text AS table, pg_get_constraintdef(oid) AS def
               FROM pg_constraint
               WHERE contype = 'c'
                 AND conrelid::regclass::text IN ('orders', 'payments', 'deliveries',
                     'inventory_movements', 'riders', 'promotions', 'support_tickets')""",
        )
    definitions = {(r["table"], r["def"]) for r in rows}
    tables = {table for table, _ in definitions}
    assert {"orders", "payments", "deliveries"} <= tables
    orders_status = [d for (t, d) in definitions if t == "orders" and "status" in d]
    assert any("DELIVERED" in d and "CANCELLED" in d for d in orders_status)


@pytest.mark.contracts
def test_every_eventless_table_has_primary_keys(seeded_db) -> None:
    with connect(autocommit=True) as conn:
        rows = fetch_all(
            conn,
            """SELECT conrelid::regclass::text AS table
               FROM pg_constraint
               WHERE contype = 'p'
               GROUP BY 1""",
        )
    tables_with_pk = {r["table"] for r in rows}
    expected = {
        "stores", "customers", "customer_addresses", "products", "product_prices",
        "inventory", "inventory_movements", "riders", "promotions", "orders",
        "order_items", "payments", "deliveries", "support_tickets",
    }
    assert expected <= tables_with_pk
