-- Q: How does order volume distribute across hours of the day?
-- Assumptions: hour of day in UTC; demonstrates the demand curve the simulator encodes.
-- Edge cases: hours with zero orders in the seeded range will not appear.
SELECT
    extract(hour FROM placed_at) AS hour_of_day,
    count(*)                     AS orders
FROM orders
GROUP BY 1
ORDER BY 1;
