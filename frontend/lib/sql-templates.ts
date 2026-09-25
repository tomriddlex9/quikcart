// SQL template catalog for the /query workbench.
//
// The 30 "postgres" templates are harvested verbatim from `sql/exercises/{beginner,
// intermediate,advanced}/*.sql` — the question is the file's `-- Q: ...` header and the
// SQL is the executable statement below it (assumptions/edge-case comments are dropped
// here; they still live in the .sql files for the annotated version). The 8 "lakehouse"
// templates are new: they read the Gold marts and Silver tables built by
// `quickcart.lakehouse.gold.marts` / `quickcart.lakehouse.silver.transforms`, using plain
// ANSI SQL (CASE WHEN instead of FILTER, no `::type` casts) so the same text is valid
// whether the execute endpoint runs it via Spark SQL or a DuckDB-over-Delta engine.

export type SqlSource = "postgres" | "lakehouse";

export interface SqlTemplate {
  id: string;
  question: string;
  source: SqlSource;
  level: "beginner" | "intermediate" | "advanced" | "lakehouse";
  sql: string;
}

const POSTGRES_TEMPLATES: SqlTemplate[] = [
  // --- beginner ---------------------------------------------------------------
  {
    id: "pg-beginner-01",
    question: "What is the total revenue (GMV) per store?",
    source: "postgres",
    level: "beginner",
    sql: `SELECT
    s.store_id,
    s.store_code,
    s.name AS store_name,
    count(o.order_id)                          AS orders,
    coalesce(sum(o.total_amount), 0)::numeric(14, 2) AS gmv
FROM stores s
LEFT JOIN orders o
    ON o.store_id = s.store_id
   AND o.status <> 'CANCELLED'
GROUP BY s.store_id, s.store_code, s.name
ORDER BY gmv DESC;`,
  },
  {
    id: "pg-beginner-02",
    question: "How many orders were placed per day?",
    source: "postgres",
    level: "beginner",
    sql: `SELECT
    date_trunc('day', placed_at)::date AS day,
    count(*)                           AS orders
FROM orders
GROUP BY 1
ORDER BY 1;`,
  },
  {
    id: "pg-beginner-03",
    question: "What are the top 10 products by revenue?",
    source: "postgres",
    level: "beginner",
    sql: `SELECT
    p.product_id,
    p.sku,
    p.name,
    sum(oi.line_total)::numeric(14, 2) AS revenue,
    sum(oi.quantity)                   AS units_sold
FROM order_items oi
JOIN products p ON p.product_id = oi.product_id
GROUP BY p.product_id, p.sku, p.name
ORDER BY revenue DESC, units_sold DESC, p.product_id
LIMIT 10;`,
  },
  {
    id: "pg-beginner-04",
    question: "What is the distribution of payment statuses?",
    source: "postgres",
    level: "beginner",
    sql: `SELECT
    status,
    count(*)                            AS attempts,
    sum(amount)::numeric(16, 2)         AS total_amount
FROM payments
GROUP BY status
ORDER BY attempts DESC;`,
  },
  {
    id: "pg-beginner-05",
    question: "How many orders were cancelled, per store?",
    source: "postgres",
    level: "beginner",
    sql: `SELECT
    s.store_id,
    s.store_code,
    count(o.order_id) AS cancelled_orders
FROM stores s
LEFT JOIN orders o
    ON o.store_id = s.store_id
   AND o.status = 'CANCELLED'
GROUP BY s.store_id, s.store_code
ORDER BY cancelled_orders DESC, s.store_id;`,
  },
  {
    id: "pg-beginner-06",
    question: "How does order volume distribute across hours of the day?",
    source: "postgres",
    level: "beginner",
    sql: `SELECT
    extract(hour FROM placed_at) AS hour_of_day,
    count(*)                     AS orders
FROM orders
GROUP BY 1
ORDER BY 1;`,
  },
  {
    id: "pg-beginner-07",
    question: "Who are the top 10 customers by lifetime spend?",
    source: "postgres",
    level: "beginner",
    sql: `SELECT
    c.customer_id,
    c.customer_code,
    sum(o.total_amount)::numeric(16, 2) AS lifetime_spend,
    count(o.order_id)                   AS orders
FROM customers c
JOIN orders o
    ON o.customer_id = c.customer_id
   AND o.status <> 'CANCELLED'
GROUP BY c.customer_id, c.customer_code
ORDER BY lifetime_spend DESC, c.customer_id
LIMIT 10;`,
  },
  {
    id: "pg-beginner-08",
    question: "What is the average basket size (units per order) per store?",
    source: "postgres",
    level: "beginner",
    sql: `SELECT
    s.store_id,
    s.store_code,
    round(avg(basket.units), 2) AS avg_units_per_order
FROM stores s
LEFT JOIN (
    SELECT o.store_id, o.order_id, sum(oi.quantity) AS units
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    GROUP BY o.store_id, o.order_id
) basket ON basket.store_id = s.store_id
GROUP BY s.store_id, s.store_code
ORDER BY s.store_id;`,
  },
  {
    id: "pg-beginner-09",
    question: "How many riders are anchored to each store?",
    source: "postgres",
    level: "beginner",
    sql: `SELECT
    s.store_id,
    s.store_code,
    count(r.rider_id) AS riders
FROM stores s
LEFT JOIN riders r ON r.home_store_id = s.store_id
GROUP BY s.store_id, s.store_code
ORDER BY riders DESC, s.store_id;`,
  },
  {
    id: "pg-beginner-10",
    question: "Which promotions are active at the end of the seeded history?",
    source: "postgres",
    level: "beginner",
    sql: `SELECT
    promotion_id,
    name,
    promotion_type,
    value,
    starts_at,
    ends_at,
    min_order_value,
    max_discount
FROM promotions
WHERE is_active
ORDER BY ends_at DESC;`,
  },

  // --- intermediate -----------------------------------------------------------
  {
    id: "pg-intermediate-01",
    question: "What is the average order value (AOV) per store and product category?",
    source: "postgres",
    level: "intermediate",
    sql: `SELECT
    s.store_code,
    p.category,
    count(DISTINCT o.order_id)        AS orders,
    avg(o.total_amount)::numeric(12, 2) AS aov
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
JOIN products p     ON p.product_id = oi.product_id
JOIN stores s       ON s.store_id = o.store_id
WHERE o.status <> 'CANCELLED'
GROUP BY s.store_code, p.category
ORDER BY s.store_code, aov DESC;`,
  },
  {
    id: "pg-intermediate-02",
    question: "What share of customers placed more than one order (repeat rate)?",
    source: "postgres",
    level: "intermediate",
    sql: `WITH per_customer AS (
    SELECT
        customer_id,
        count(*) AS orders
    FROM orders
    GROUP BY customer_id
)
SELECT
    count(*)                                                    AS customers_with_orders,
    count(*) FILTER (WHERE orders >= 2)                         AS repeat_customers,
    round(
        count(*) FILTER (WHERE orders >= 2)::numeric / count(*),
        4
    )                                                           AS repeat_rate
FROM per_customer;`,
  },
  {
    id: "pg-intermediate-03",
    question:
      "What is each rider's utilization (deliveries completed vs cancelled while assigned)?",
    source: "postgres",
    level: "intermediate",
    sql: `SELECT
    coalesce(r.rider_id::text, 'UNASSIGNED')                          AS rider,
    count(*) FILTER (WHERE d.status = 'DELIVERED')                    AS delivered,
    count(*) FILTER (WHERE d.status = 'CANCELLED')                    AS cancelled,
    round(
        count(*) FILTER (WHERE d.status = 'DELIVERED')::numeric
        / count(*),
        4
    )                                                                 AS utilization_rate
FROM deliveries d
LEFT JOIN riders r ON r.rider_id = d.rider_id
GROUP BY coalesce(r.rider_id::text, 'UNASSIGNED')
ORDER BY delivered DESC;`,
  },
  {
    id: "pg-intermediate-04",
    question: "How does delivery SLA performance vary by order hour?",
    source: "postgres",
    level: "intermediate",
    sql: `SELECT
    extract(hour FROM o.placed_at)                                   AS hour_of_day,
    count(*)                                                         AS deliveries,
    round(avg(extract(epoch FROM (d.delivered_at - d.picked_up_at)) / 60.0), 2) AS avg_ride_minutes,
    count(*) FILTER (WHERE d.delivered_at <= d.promised_by)          AS on_time,
    round(
        count(*) FILTER (WHERE d.delivered_at <= d.promised_by)::numeric / count(*),
        4
    )                                                                AS on_time_rate
FROM deliveries d
JOIN orders o ON o.order_id = d.order_id
WHERE d.status = 'DELIVERED'
GROUP BY 1
ORDER BY 1;`,
  },
  {
    id: "pg-intermediate-05",
    question:
      "How effective is each promotion (redemption count, attached revenue, discount cost)?",
    source: "postgres",
    level: "intermediate",
    sql: `SELECT
    p.promotion_id,
    p.name,
    p.promotion_type,
    count(o.order_id)                                       AS redemptions,
    count(o.order_id) FILTER (WHERE o.status <> 'CANCELLED') AS completed_redemptions,
    coalesce(sum(o.total_amount) FILTER (WHERE o.status <> 'CANCELLED'), 0)::numeric(16, 2) AS revenue,
    coalesce(sum(o.promo_discount), 0)::numeric(16, 2)      AS discount_cost
FROM promotions p
LEFT JOIN orders o ON o.promotion_id = p.promotion_id
GROUP BY p.promotion_id, p.name, p.promotion_type
ORDER BY redemptions DESC;`,
  },
  {
    id: "pg-intermediate-06",
    question: "What does the stock movement profile look like per store?",
    source: "postgres",
    level: "intermediate",
    sql: `SELECT
    s.store_code,
    m.movement_type,
    count(*)               AS movements,
    sum(m.quantity_delta)  AS net_units
FROM stores s
LEFT JOIN inventory_movements m ON m.store_id = s.store_id
GROUP BY s.store_code, m.movement_type
ORDER BY s.store_code, movements DESC;`,
  },
  {
    id: "pg-intermediate-07",
    question: "How does revenue split across product categories?",
    source: "postgres",
    level: "intermediate",
    sql: `SELECT
    p.category,
    sum(oi.line_total)::numeric(16, 2)                          AS revenue,
    round(
        sum(oi.line_total) / sum(sum(oi.line_total)) OVER (),
        4
    )                                                           AS revenue_share
FROM order_items oi
JOIN products p ON p.product_id = oi.product_id
GROUP BY p.category
ORDER BY revenue DESC;`,
  },
  {
    id: "pg-intermediate-08",
    question: "Which payment methods fail most often?",
    source: "postgres",
    level: "intermediate",
    sql: `SELECT
    payment_method,
    count(*)                                                          AS attempts,
    count(*) FILTER (WHERE status = 'FAILED')                         AS failures,
    round(
        count(*) FILTER (WHERE status = 'FAILED')::numeric / count(*),
        4
    )                                                                 AS failure_rate,
    avg(attempt_number)::numeric(5, 2)                                AS avg_attempts
FROM payments
GROUP BY payment_method
ORDER BY failure_rate DESC;`,
  },
  {
    id: "pg-intermediate-09",
    question: "What is the average end-to-end fulfillment time per store?",
    source: "postgres",
    level: "intermediate",
    sql: `SELECT
    s.store_code,
    count(d.delivery_id) FILTER (WHERE d.status = 'DELIVERED')          AS delivered,
    round(avg(extract(epoch FROM (d.assigned_at  - o.placed_at)) / 60.0)
          FILTER (WHERE d.status = 'DELIVERED'), 2)                     AS avg_wait_minutes,
    round(avg(extract(epoch FROM (d.picked_up_at - d.assigned_at)) / 60.0)
          FILTER (WHERE d.status = 'DELIVERED'), 2)                     AS avg_pick_minutes,
    round(avg(extract(epoch FROM (d.delivered_at - o.placed_at)) / 60.0)
          FILTER (WHERE d.status = 'DELIVERED'), 2)                     AS avg_fulfillment_minutes
FROM stores s
LEFT JOIN orders o    ON o.store_id = s.store_id
LEFT JOIN deliveries d ON d.order_id = o.order_id
GROUP BY s.store_code
ORDER BY avg_fulfillment_minutes DESC NULLS LAST;`,
  },
  {
    id: "pg-intermediate-10",
    question: "How do weekends compare to weekdays in order volume and revenue?",
    source: "postgres",
    level: "intermediate",
    sql: `SELECT
    CASE WHEN extract(isodow FROM placed_at) >= 6 THEN 'weekend' ELSE 'weekday' END AS day_type,
    count(DISTINCT date_trunc('day', placed_at))                                    AS days,
    count(*)                                                                        AS orders,
    round(count(*)::numeric / count(DISTINCT date_trunc('day', placed_at)), 2)      AS avg_orders_per_day,
    sum(total_amount)::numeric(16, 2)                                               AS gmv,
    round(avg(total_amount)::numeric, 2)                                            AS aov
FROM orders
GROUP BY 1
ORDER BY 1;`,
  },

  // --- advanced -----------------------------------------------------------------
  {
    id: "pg-advanced-01",
    question: "What is monthly cohort retention (do month-0 customers order in later months)?",
    source: "postgres",
    level: "advanced",
    sql: `WITH first_orders AS (
    SELECT
        customer_id,
        date_trunc('month', min(placed_at)) AS cohort_month
    FROM orders
    GROUP BY customer_id
),
activity AS (
    SELECT DISTINCT
        f.customer_id,
        f.cohort_month,
        months_between.month_offset
    FROM first_orders f
    JOIN orders o
        ON o.customer_id = f.customer_id
    JOIN LATERAL (
        SELECT (extract(year FROM o.placed_at) - extract(year FROM f.cohort_month)) * 12
             + (extract(month FROM o.placed_at) - extract(month FROM f.cohort_month)) AS month_offset
    ) months_between ON TRUE
)
SELECT
    f.cohort_month::date                                   AS cohort_month,
    count(DISTINCT f.customer_id)                        AS cohort_size,
    count(DISTINCT a.customer_id) FILTER (WHERE a.month_offset = 1) AS retained_m1,
    count(DISTINCT a.customer_id) FILTER (WHERE a.month_offset = 2) AS retained_m2,
    round(
        count(DISTINCT a.customer_id) FILTER (WHERE a.month_offset = 1)::numeric
        / count(DISTINCT f.customer_id),
        4
    )                                                    AS retention_m1,
    round(
        count(DISTINCT a.customer_id) FILTER (WHERE a.month_offset = 2)::numeric
        / count(DISTINCT f.customer_id),
        4
    )                                                    AS retention_m2
FROM first_orders f
LEFT JOIN activity a
    ON a.customer_id = f.customer_id
GROUP BY f.cohort_month
ORDER BY f.cohort_month;`,
  },
  {
    id: "pg-advanced-02",
    question: "What does the order funnel look like (payment → fulfillment → delivery)?",
    source: "postgres",
    level: "advanced",
    sql: `WITH stages AS (
    SELECT
        count(*) AS placed,
        count(*) FILTER (WHERE status IN ('DELIVERED', 'REFUNDED', 'CANCELLED')) AS resolved,
        count(*) FILTER (WHERE status IN ('DELIVERED', 'REFUNDED')) AS fulfilled,
        count(*) FILTER (WHERE status = 'DELIVERED') AS delivered,
        count(*) FILTER (WHERE status = 'CANCELLED') AS cancelled,
        count(*) FILTER (WHERE status = 'REFUNDED') AS refunded
    FROM orders
)
SELECT
    placed,
    fulfilled,
    delivered,
    cancelled,
    refunded,
    round(fulfilled::numeric / placed, 4)  AS placed_to_fulfilled,
    round(delivered::numeric / fulfilled, 4) AS fulfilled_to_delivered,
    round(cancelled::numeric / placed, 4)  AS cancellation_rate
FROM stages;`,
  },
  {
    id: "pg-advanced-03",
    question: "What is the trailing 7-day revenue per store (rolling window)?",
    source: "postgres",
    level: "advanced",
    sql: `WITH daily AS (
    SELECT
        store_id,
        date_trunc('day', placed_at) AS day,
        sum(total_amount) AS revenue
    FROM orders
    WHERE status <> 'CANCELLED'
    GROUP BY store_id, date_trunc('day', placed_at)
)
SELECT
    store_id,
    day::date,
    revenue::numeric(14, 2) AS day_revenue,
    sum(revenue) OVER (
        PARTITION BY store_id
        ORDER BY day
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    )::numeric(16, 2)       AS rolling_7d_revenue
FROM daily
ORDER BY store_id, day;`,
  },
  {
    id: "pg-advanced-04",
    question: "How did this week's cancellations move versus the prior week (WoW %)?",
    source: "postgres",
    level: "advanced",
    sql: `WITH weekly AS (
    SELECT
        date_trunc('week', placed_at) AS week,
        count(*) FILTER (WHERE status = 'CANCELLED') AS cancellations,
        count(*) AS orders
    FROM orders
    GROUP BY 1
)
SELECT
    week::date                                                        AS week_start,
    orders,
    cancellations,
    lag(cancellations) OVER w                                         AS prior_week_cancellations,
    round(
        (cancellations - lag(cancellations) OVER w)::numeric
        / nullif(lag(cancellations) OVER w, 0),
        4
    )                                                                 AS wow_change
FROM weekly
WINDOW w AS (ORDER BY week)
ORDER BY week;`,
  },
  {
    id: "pg-advanced-05",
    question: "How do products rank within their category by revenue (top 3 per category)?",
    source: "postgres",
    level: "advanced",
    sql: `WITH product_revenue AS (
    SELECT
        p.category,
        p.product_id,
        p.name,
        sum(oi.line_total) AS revenue,
        rank() OVER (PARTITION BY p.category ORDER BY sum(oi.line_total) DESC) AS revenue_rank
    FROM order_items oi
    JOIN products p ON p.product_id = oi.product_id
    GROUP BY p.category, p.product_id, p.name
)
SELECT
    category,
    product_id,
    name,
    revenue::numeric(14, 2),
    revenue_rank,
    row_number() OVER (
        PARTITION BY category ORDER BY revenue DESC, product_id
    ) AS deterministic_rank
FROM product_revenue
WHERE revenue_rank <= 3
ORDER BY category, revenue_rank, product_id;`,
  },
  {
    id: "pg-advanced-06",
    question: "Where does each store sit in the network-wide performance distribution?",
    source: "postgres",
    level: "advanced",
    sql: `WITH store_gmv AS (
    SELECT
        s.store_id,
        s.store_code,
        coalesce(sum(o.total_amount) FILTER (WHERE o.status <> 'CANCELLED'), 0) AS gmv
    FROM stores s
    LEFT JOIN orders o ON o.store_id = s.store_id
    GROUP BY s.store_id, s.store_code
)
SELECT
    store_id,
    store_code,
    gmv::numeric(16, 2)                                            AS gmv,
    round(percent_rank() OVER (ORDER BY gmv)::numeric, 4)          AS gmv_percentile,
    ntile(4) OVER (ORDER BY gmv)                                   AS performance_quartile
FROM store_gmv
ORDER BY gmv DESC;`,
  },
  {
    id: "pg-advanced-07",
    question:
      "How many days of cover does each store/product have (on-hand vs recent demand)?",
    source: "postgres",
    level: "advanced",
    sql: `WITH recent_sales AS (
    SELECT
        m.store_id,
        m.product_id,
        sum(-m.quantity_delta) AS units_sold,
        count(DISTINCT date_trunc('day', m.occurred_at)) AS selling_days
    FROM inventory_movements m
    WHERE m.movement_type = 'SALE'
      AND m.occurred_at >= (SELECT max(occurred_at) - interval '14 days' FROM inventory_movements)
    GROUP BY m.store_id, m.product_id
)
SELECT
    i.store_id,
    i.product_id,
    i.on_hand_qty,
    i.reorder_point,
    coalesce(rs.units_sold, 0)                                            AS units_sold_14d,
    round(coalesce(rs.units_sold, 0)::numeric / 14, 4)                    AS avg_daily_units,
    CASE
        WHEN coalesce(rs.units_sold, 0) = 0 THEN NULL
        ELSE round(i.on_hand_qty::numeric / (rs.units_sold::numeric / 14), 2)
    END                                                                   AS stock_cover_days
FROM inventory i
LEFT JOIN recent_sales rs
    ON rs.store_id = i.store_id
   AND rs.product_id = i.product_id
ORDER BY stock_cover_days ASC NULLS LAST, i.store_id, i.product_id
LIMIT 50;`,
  },
  {
    id: "pg-advanced-08",
    question: "Which customers fall into which RFM bucket (recency, frequency, monetary)?",
    source: "postgres",
    level: "advanced",
    sql: `WITH params AS (
    SELECT max(placed_at) AS as_of FROM orders
),
rfm AS (
    SELECT
        o.customer_id,
        extract(day FROM (params.as_of - max(o.placed_at)))::int AS recency_days,
        count(*)                                                 AS frequency,
        sum(o.total_amount)                                      AS monetary
    FROM orders o
    CROSS JOIN params
    WHERE o.status <> 'CANCELLED'
    GROUP BY o.customer_id, params.as_of
),
scored AS (
    SELECT
        customer_id,
        recency_days,
        frequency,
        monetary::numeric(16, 2) AS monetary,
        ntile(4) OVER (ORDER BY recency_days DESC) AS r_score,  -- recent = high score
        ntile(4) OVER (ORDER BY frequency)         AS f_score,
        ntile(4) OVER (ORDER BY monetary)          AS m_score
    FROM rfm
)
SELECT
    customer_id,
    recency_days,
    frequency,
    monetary,
    r_score * 100 + f_score * 10 + m_score AS rfm_composite,
    CASE
        WHEN r_score = 4 AND f_score >= 3 THEN 'champion'
        WHEN r_score >= 3 AND f_score = 1 THEN 'new'
        WHEN r_score <= 2 AND f_score >= 3 THEN 'at_risk'
        WHEN r_score <= 2 AND f_score <= 2 THEN 'dormant'
        ELSE 'regular'
    END                                    AS rfm_segment
FROM scored
ORDER BY rfm_composite DESC
LIMIT 50;`,
  },
  {
    id: "pg-advanced-09",
    question:
      "How do daily delivery minutes trend, and how does each day compare to the prior day?",
    source: "postgres",
    level: "advanced",
    sql: `WITH daily AS (
    SELECT
        date_trunc('day', o.placed_at) AS day,
        avg(extract(epoch FROM (d.delivered_at - d.picked_up_at)) / 60.0) AS avg_ride_minutes,
        count(*) AS deliveries
    FROM deliveries d
    JOIN orders o ON o.order_id = d.order_id
    WHERE d.status = 'DELIVERED'
    GROUP BY 1
)
SELECT
    day::date,
    deliveries,
    round(avg_ride_minutes::numeric, 2)                                    AS avg_ride_minutes,
    round(lag(avg_ride_minutes)  OVER (ORDER BY day)::numeric, 2)          AS prior_day_minutes,
    round(lead(avg_ride_minutes) OVER (ORDER BY day)::numeric, 2)          AS next_day_minutes,
    round(avg_ride_minutes::numeric
          - lag(avg_ride_minutes) OVER (ORDER BY day)::numeric, 2)         AS delta_vs_prior,
    round(
        (avg_ride_minutes / nullif(lag(avg_ride_minutes) OVER (ORDER BY day), 0) - 1) * 100,
        2
    )                                                                      AS pct_change_vs_prior
FROM daily
ORDER BY day;`,
  },
  {
    id: "pg-advanced-10",
    question: "Which stores have the worst late-delivery record (leaderboard with lateness detail)?",
    source: "postgres",
    level: "advanced",
    sql: `WITH delivered AS (
    SELECT
        o.store_id,
        d.delivered_at > d.promised_by AS is_late,
        extract(epoch FROM (d.delivered_at - d.promised_by)) / 60.0 AS minutes_vs_promise
    FROM deliveries d
    JOIN orders o ON o.order_id = d.order_id
    WHERE d.status = 'DELIVERED'
)
SELECT
    s.store_code,
    count(*)                                                             AS deliveries,
    count(*) FILTER (WHERE is_late)                                      AS late_deliveries,
    round(count(*) FILTER (WHERE is_late)::numeric / count(*), 4)        AS late_rate,
    round(avg(minutes_vs_promise) FILTER (WHERE is_late)::numeric, 2)    AS avg_lateness_minutes,
    round(percentile_cont(0.9) WITHIN GROUP (ORDER BY minutes_vs_promise)::numeric, 2)
                                                                         AS p90_lateness_minutes
FROM delivered
JOIN stores s ON s.store_id = delivered.store_id
GROUP BY s.store_code
HAVING count(*) >= 20
ORDER BY late_rate DESC, avg_lateness_minutes DESC;`,
  },
];

// --- lakehouse: Gold marts + Silver tables (kit/03 §4.4 / §4.3) -------------------
// Written in portable ANSI SQL (CASE WHEN instead of FILTER, no `::type` casts) so
// the text runs unchanged whether the execute endpoint is Spark SQL or a DuckDB
// engine reading the same Delta tables.
const LAKEHOUSE_TEMPLATES: SqlTemplate[] = [
  {
    id: "lh-01",
    question: "Which stores generated the most GMV, and how much of it was cancelled?",
    source: "lakehouse",
    level: "lakehouse",
    sql: `SELECT
    store_id,
    SUM(orders_placed)    AS orders_placed,
    SUM(orders_cancelled) AS orders_cancelled,
    SUM(gmv)              AS gmv,
    SUM(net_revenue)      AS net_revenue,
    ROUND(SUM(orders_cancelled) * 1.0 / SUM(orders_placed), 4) AS cancel_rate
FROM gold_store_hourly_metrics
GROUP BY store_id
ORDER BY gmv DESC;`,
  },
  {
    id: "lh-02",
    question: "How does hourly demand, GMV and late-delivery rate trend across the network?",
    source: "lakehouse",
    level: "lakehouse",
    sql: `SELECT
    metric_hour,
    SUM(orders_placed)                      AS orders_placed,
    SUM(gmv)                                AS gmv,
    ROUND(AVG(late_delivery_rate), 4)       AS avg_late_delivery_rate,
    ROUND(AVG(payment_failure_rate), 4)     AS avg_payment_failure_rate
FROM gold_store_hourly_metrics
GROUP BY metric_hour
ORDER BY metric_hour;`,
  },
  {
    id: "lh-03",
    question: "Who are the top 20 customers by lifetime spend in the Customer 360 mart?",
    source: "lakehouse",
    level: "lakehouse",
    sql: `SELECT
    customer_id,
    lifetime_orders,
    lifetime_spend,
    avg_order_value,
    cancel_rate,
    days_since_last_order,
    preferred_store_id,
    preferred_category
FROM gold_customer_360
ORDER BY lifetime_spend DESC
LIMIT 20;`,
  },
  {
    id: "lh-04",
    question: "Which high-value customers look at risk of churning (no recent orders)?",
    source: "lakehouse",
    level: "lakehouse",
    sql: `SELECT
    customer_id,
    lifetime_spend,
    lifetime_orders,
    days_since_last_order,
    preferred_store_id,
    preferred_category
FROM gold_customer_360
WHERE days_since_last_order > 14
ORDER BY lifetime_spend DESC
LIMIT 25;`,
  },
  {
    id: "lh-05",
    question: "Which store/product combinations are below their reorder point right now?",
    source: "lakehouse",
    level: "lakehouse",
    sql: `SELECT
    store_id,
    product_id,
    on_hand_qty,
    reserved_qty,
    available_qty,
    reorder_point,
    avg_hourly_sales_7d,
    stock_cover_hours
FROM gold_inventory_health
WHERE is_below_reorder_point = true
ORDER BY stock_cover_hours ASC
LIMIT 50;`,
  },
  {
    id: "lh-06",
    question: "How many SKUs per store are below reorder point, and what is the average stock cover?",
    source: "lakehouse",
    level: "lakehouse",
    sql: `SELECT
    store_id,
    COUNT(*)                                                        AS skus_tracked,
    SUM(CASE WHEN is_below_reorder_point THEN 1 ELSE 0 END)         AS skus_below_reorder,
    ROUND(AVG(stock_cover_hours), 2)                                AS avg_stock_cover_hours
FROM gold_inventory_health
GROUP BY store_id
ORDER BY skus_below_reorder DESC;`,
  },
  {
    id: "lh-07",
    question: "Which stores have the worst late-delivery rate in the delivery performance mart?",
    source: "lakehouse",
    level: "lakehouse",
    sql: `SELECT
    store_id,
    COUNT(*)                                                             AS deliveries,
    SUM(CASE WHEN is_late THEN 1 ELSE 0 END)                             AS late_deliveries,
    ROUND(SUM(CASE WHEN is_late THEN 1 ELSE 0 END) * 1.0 / COUNT(*), 4)  AS late_rate,
    ROUND(AVG(total_fulfillment_minutes), 2)                            AS avg_fulfillment_minutes
FROM gold_delivery_performance
GROUP BY store_id
ORDER BY late_rate DESC;`,
  },
  {
    id: "lh-08",
    question: "What does daily order volume and GMV look like straight from Silver, per store?",
    source: "lakehouse",
    level: "lakehouse",
    sql: `SELECT
    s.store_id,
    s.store_code,
    s.city,
    COUNT(o.order_id)                                                    AS orders,
    SUM(CASE WHEN o.status <> 'CANCELLED' THEN o.total_amount ELSE 0 END) AS gmv
FROM silver_stores s
LEFT JOIN silver_orders o ON o.store_id = s.store_id
GROUP BY s.store_id, s.store_code, s.city
ORDER BY gmv DESC;`,
  },
];

/** All templates for the /query workbench: 30 postgres exercises + 8 lakehouse marts. */
export const SQL_TEMPLATES: SqlTemplate[] = [...POSTGRES_TEMPLATES, ...LAKEHOUSE_TEMPLATES];
