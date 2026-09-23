# QuickCart — Initial Data Model and Event Contracts

This document gives the implementation enough structure to start without over-designing the entire business domain.

---

# 1. Modeling conventions

- Use snake_case names.
- Use UUIDs or stable integer IDs consistently per entity; do not mix randomly.
- Store timestamps in UTC.
- Persist currency with `NUMERIC`, not floating point.
- Use ISO currency code where useful even if the initial simulator uses INR only.
- Use explicit status enums/check constraints where practical.
- Soft-delete behavior must be explicit per table.
- Every event has `event_id`, `event_type`, `event_time`, `schema_version`.

---

# 2. Core relational model

## stores

Suggested fields:

```text
store_id PK
store_code UNIQUE
name
city
latitude
longitude
service_radius_km
opened_at
is_active
created_at
updated_at
```

## customers

```text
customer_id PK
customer_code UNIQUE
created_at
updated_at
is_active
```

Avoid generating unnecessary realistic PII. Names may be synthetic; phone/email are not required for core learning.

## customer_addresses

```text
address_id PK
customer_id FK
city
postal_code
latitude
longitude
is_default
valid_from
valid_to
created_at
updated_at
```

Can later become an SCD2 learning source.

## products

```text
product_id PK
sku UNIQUE
name
category
subcategory
brand
unit_size
unit_name
is_active
created_at
updated_at
```

## product_prices

```text
product_price_id PK
product_id FK
store_id FK nullable if global
mrp
selling_price
valid_from
valid_to
created_at
```

## inventory

```text
store_id FK
product_id FK
on_hand_qty
reserved_qty
reorder_point
updated_at
PRIMARY KEY(store_id, product_id)
```

## inventory_movements

```text
movement_id PK
store_id FK
product_id FK
movement_type
quantity_delta
reference_type
reference_id
occurred_at
created_at
```

Movement types:

- RECEIPT
- ORDER_RESERVE
- ORDER_RELEASE
- SALE
- MANUAL_ADJUSTMENT
- TRANSFER_IN
- TRANSFER_OUT
- DAMAGE

## riders

```text
rider_id PK
home_store_id FK
status
shift_start
shift_end
created_at
updated_at
```

## promotions

```text
promotion_id PK
name
promotion_type
value
starts_at
ends_at
min_order_value
max_discount
is_active
```

## orders

```text
order_id PK
customer_id FK
store_id FK
address_id FK
promotion_id FK nullable
status
subtotal
item_discount
promo_discount
delivery_fee
tax_amount
total_amount
currency
placed_at
updated_at
```

Order status progression:

```text
CREATED
PLACED
PAYMENT_PENDING
PAID
ACCEPTED
PICKING
PACKED
RIDER_ASSIGNED
OUT_FOR_DELIVERY
DELIVERED
CANCELLED
REFUNDED
```

Not every order must pass through every state.

## order_items

```text
order_item_id PK
order_id FK
product_id FK
quantity
unit_price
line_discount
line_total
created_at
```

## payments

```text
payment_id PK
order_id FK
payment_method
status
amount
currency
attempt_number
failure_code nullable
created_at
updated_at
```

Statuses:

- INITIATED
- AUTHORIZED
- CAPTURED
- FAILED
- REFUNDED

## deliveries

```text
delivery_id PK
order_id FK UNIQUE
rider_id FK nullable
promised_by
assigned_at
picked_up_at
delivered_at
cancelled_at
estimated_distance_km
status
created_at
updated_at
```

## support_tickets

```text
ticket_id PK
customer_id FK nullable
order_id FK nullable
category
priority
status
subject
body
created_at
updated_at
```

---

# 3. Recommended indexes

Add only after baseline queries exist, but likely candidates:

```text
orders(store_id, placed_at)
orders(customer_id, placed_at)
orders(status, placed_at)
order_items(order_id)
order_items(product_id)
inventory(store_id, product_id)
deliveries(rider_id, status)
payments(order_id, status)
inventory_movements(store_id, product_id, occurred_at)
```

Record query-plan evidence before/after index exercises.

---

# 4. Event envelope

Every non-CDC business event should use a common envelope.

```json
{
  "event_id": "uuid",
  "event_type": "ORDER_PLACED",
  "schema_version": 1,
  "event_time": "2026-09-23T12:30:00Z",
  "producer": "quickcart-simulator",
  "entity_type": "order",
  "entity_id": "12345",
  "store_id": "STORE-007",
  "payload": {}
}
```

## Required semantics

- `event_id` is globally unique and stable across retries.
- `event_time` represents when the business event occurred.
- broker ingestion time is separate.
- `entity_id` allows tracing.
- `schema_version` supports controlled evolution.

---

# 5. Key event payloads

## ORDER_PLACED

```json
{
  "order_id": 12345,
  "customer_id": 991,
  "store_id": 7,
  "item_count": 4,
  "subtotal": "560.00",
  "discount": "40.00",
  "total_amount": "520.00",
  "currency": "INR"
}
```

## PAYMENT_COMPLETED

```json
{
  "payment_id": 80001,
  "order_id": 12345,
  "amount": "520.00",
  "method": "UPI",
  "attempt_number": 1
}
```

## PAYMENT_FAILED

```json
{
  "payment_id": 80002,
  "order_id": 12346,
  "method": "CARD",
  "attempt_number": 1,
  "failure_code": "SIMULATED_BANK_DECLINE"
}
```

## RIDER_ASSIGNED

```json
{
  "order_id": 12345,
  "delivery_id": 60001,
  "rider_id": 301,
  "estimated_distance_km": 3.7
}
```

## ORDER_DELIVERED

```json
{
  "order_id": 12345,
  "delivery_id": 60001,
  "rider_id": 301,
  "promised_by": "2026-09-23T13:00:00Z",
  "delivered_at": "2026-09-23T12:56:00Z"
}
```

## INVENTORY_ADJUSTED

```json
{
  "store_id": 7,
  "product_id": 2001,
  "quantity_delta": -2,
  "movement_type": "SALE",
  "reference_type": "ORDER",
  "reference_id": "12345"
}
```

---

# 6. Topics

Initial topic names:

```text
quickcart.order-events.v1
quickcart.app-events.v1
quickcart.rider-events.v1
quickcart.inventory-events.v1
```

Recommended keys:

- order events → `order_id`
- rider events → `rider_id`
- inventory events → `store_id:product_id`

Topic partition count should be small locally. The point is to learn partition behavior, not simulate a large cluster.

---

# 7. CDC contract

Debezium events should initially be stored in Bronze largely as received.

Normalized CDC fields required downstream:

```text
source_table
operation
business_key
before_json
after_json
source_event_time
source_position
transaction_id if available
ingested_at
```

Operation mapping:

```text
c/create → INSERT
u/update → UPDATE
d/delete → DELETE
r/read/snapshot → SNAPSHOT
```

The exact Debezium envelope should be parsed through a dedicated adapter so downstream Silver logic is not tightly coupled to broker serialization details.

---

# 8. Bronze table naming

Examples:

```text
bronze_postgres_orders_snapshot
bronze_orders_cdc
bronze_inventory_cdc
bronze_order_events
bronze_app_events
bronze_weather
bronze_supplier_catalog
```

Bronze should preserve source naming context rather than pretending raw feeds are already conformed business entities.

---

# 9. Silver table naming

Examples:

```text
silver_orders
silver_order_items
silver_customers
silver_customer_addresses_scd2
silver_products
silver_product_prices_scd2
silver_inventory
silver_inventory_movements
silver_payments
silver_deliveries
silver_riders
silver_support_tickets
```

---

# 10. Gold table contracts

## gold_store_hourly_metrics

Grain:

```text
one row per store per hour
```

Suggested columns:

```text
metric_hour
store_id
orders_placed
orders_delivered
orders_cancelled
gmv
net_revenue
avg_order_value
cancel_rate
avg_pick_minutes
avg_delivery_minutes
late_delivery_rate
active_riders_estimate
payment_failure_rate
```

## gold_customer_360

Grain:

```text
one current row per customer
```

Suggested columns:

```text
customer_id
first_order_at
last_order_at
lifetime_orders
lifetime_spend
avg_order_value
cancel_rate
days_since_last_order
preferred_store_id
preferred_category
promo_order_share
```

## gold_inventory_health

Grain:

```text
one row per store/product/snapshot time
```

Suggested columns:

```text
snapshot_at
store_id
product_id
on_hand_qty
reserved_qty
available_qty
sales_last_1h
sales_last_24h
avg_hourly_sales_7d
stock_cover_hours
reorder_point
is_below_reorder_point
```

Later append:

```text
forecast_demand_1h
forecast_demand_2h
stockout_probability
model_version
```

## gold_delivery_performance

Grain:

```text
one row per completed/cancelled delivery
```

Suggested columns:

```text
order_id
delivery_id
store_id
rider_id
placed_at
assigned_at
picked_up_at
delivered_at
promised_by
pick_minutes
delivery_minutes
total_fulfillment_minutes
is_late
estimated_distance_km
weather_condition
```

---

# 11. Data quality rule catalog

Start rule IDs such as:

```text
DQ-ORDER-001 order_id not null
DQ-ORDER-002 store_id exists
DQ-ORDER-003 customer_id exists
DQ-ORDER-004 total_amount >= 0
DQ-ORDER-005 status allowed
DQ-ITEM-001 quantity > 0
DQ-ITEM-002 product exists
DQ-PAY-001 amount >= 0
DQ-DEL-001 delivered_at >= placed_at
DQ-EVENT-001 event_id unique within retention window
DQ-EVENT-002 event_time parseable
DQ-INV-001 product/store exists
```

Each rule should have severity and handling policy.

---

# 12. Intentional bad-data scenarios

Simulator/export layer should be able to create tagged scenarios:

```text
duplicate_order_event
late_delivery_event
missing_customer_reference
unknown_product_reference
negative_payment_amount
malformed_timestamp
new_optional_schema_field
duplicate_payment_cdc
out_of_order_status_event
inventory_negative_discrepancy
```

These scenarios must be opt-in and reproducible with seeds.
