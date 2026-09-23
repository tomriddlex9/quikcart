-- Q: Which payment methods fail most often?
-- Assumptions: failure rate = FAILED attempts / all attempts per method; COD never
--   fails by construction of the simulator.
-- Edge cases: methods with very few attempts can show noisy rates.
SELECT
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
ORDER BY failure_rate DESC;
