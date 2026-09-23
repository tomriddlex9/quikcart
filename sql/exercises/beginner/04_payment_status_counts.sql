-- Q: What is the distribution of payment statuses?
-- Assumptions: one row per payment attempt; an order can contribute several rows.
-- Edge cases: statuses are the CHECK-constrained enum from V001.
SELECT
    status,
    count(*)                            AS attempts,
    sum(amount)::numeric(16, 2)         AS total_amount
FROM payments
GROUP BY status
ORDER BY attempts DESC;
