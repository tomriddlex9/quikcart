# Medallion expansion · Layers ops · Data cube

Date: 2026-09-25  
Status: approved by user instruction (“plan then implement without asking”)

## Problem

QuickCart’s Delta medallion covers core commerce tables, but the showcase under-represents:

- External API feeds (weather, news)
- High-frequency streams (rider locations, inventory updates, tickets, escalations)
- The *why* of bronze → silver → gold (operations and impact)
- An interactive OLAP mental model for teaching slice/dice/rollup

## Approach (chosen)

**Showcase-first, contract-backed expansion.**

1. Extend lineage + schemas + catalog so new entities are first-class in the map.
2. Ship API surfaces that describe every layer operation and its measurable impact.
3. Ship a Three.js data-cube console that applies PySpark/SQL-shaped ops and animates cell changes.
4. Promote weather (already raw) and tickets (already Postgres) into bronze/silver/gold contracts; add news, rider_locations, inventory_updates, escalations as schemas + generators + lineage even when Spark promotion is incremental.

Rejected alternatives: (A) full Spark pipelines for every stream before UI — too slow for EC2 demo; (B) frontend-only mock with no API contracts — drifts from the live console pattern.

## New entities (medallion targets)

| Entity | Source | Bronze | Silver | Gold |
|---|---|---|---|---|
| weather | Open-Meteo / fixture JSONL | `bronze_weather` | `silver_weather` | joins `gold_delivery_performance`, `gold_weather_impact` |
| news | Headline feed / fixture | `bronze_news` | `silver_news` | `gold_demand_signals` |
| rider_locations | Kafka `quickcart.rider-locations.v1` | `bronze_rider_locations` | `silver_rider_locations` | `gold_fleet_heatmap` |
| inventory_updates | CDC + events | `bronze_inventory_updates` | merge → `silver_inventory` | `gold_inventory_health` |
| support_tickets | Postgres export | `bronze_support_tickets` | `silver_support_tickets` | `gold_ticket_sla` |
| escalations | Postgres + agent proposals | `bronze_escalations` | `silver_escalations` | `gold_escalation_board` |

## APIs

- `GET /api/v1/layers/operations` — catalog of ops per layer with impact metrics
- `GET /api/v1/layers/sample/{layer}` — before/after row samples for a layer
- `GET /api/v1/cube/state` — dimensions, measures, cells
- `POST /api/v1/cube/operate` — `{op, args}` → new cube state + animation hints

## Frontend

- `/layers` (OPS) — stacked bronze/silver/gold workbench; pick an op; see impact meters + sample diffs
- `/cube` (OPS) — Three.js 3D cube; toolbar of filter / slice / dice / rollup / drill / pivot / sql; animated cell morphs

## Non-goals (this pass)

- New paid external API keys
- Replacing GoldReaders Spark paths for every new mart on EC2 in one cut
- Full Debezium include-list for every new PG table before seed data exists
