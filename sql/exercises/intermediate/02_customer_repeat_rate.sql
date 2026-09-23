-- Q: What share of customers placed more than one order (repeat rate)?
-- Assumptions: repeat rate = customers with ≥ 2 orders / all customers who ever ordered.
-- Edge cases: customers with zero orders excluded from the denominator (they never
--   engaged; including them is a separate "activation" metric).
WITH per_customer AS (
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
FROM per_customer;
