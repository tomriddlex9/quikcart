.PHONY: help setup lint format test core-up core-down db-init db-reset seed seed-smoke db-check export-raw spark-demo

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "%-14s %s\n", $$1, $$2}'

setup: ## Install locked dependencies and create .env from .env.example
	uv sync --all-groups
	cp -n .env.example .env || true

lint: ## Run Ruff checks
	uv run ruff check .

format: ## Format code with Ruff
	uv run ruff format .

test: ## Run the test suite
	uv run pytest

core-up: ## Start PostgreSQL (compose core profile)
	docker compose --profile core up -d

core-down: ## Stop PostgreSQL
	docker compose --profile core down

db-init: ## Apply pending database migrations
	uv run python -m quickcart.db.init

db-reset: ## Drop and recreate the application schema, then re-migrate (destructive to data)
	uv run python -m quickcart.db.reset

seed: ## Seed reference data and run the full historical simulation (seed 42, 100k orders)
	uv run python -m quickcart.simulator.seed_reference
	uv run python -m quickcart.simulator.historical --seed 42 --orders 100000

seed-smoke: ## Seed a tiny deterministic dataset for quick integration checks
	uv run python -m quickcart.simulator.seed_reference --smoke
	uv run python -m quickcart.simulator.historical --seed 42 --orders 500 --smoke

db-check: ## Validate database contents (integrity, ordering, causal sanity)
	uv run python -m quickcart.db.validate

export-raw: ## Export PostgreSQL tables to data/raw (CSV + supplier catalog + JSONL events)
	uv run python -m quickcart.ingestion.export

spark-demo: ## Phase 3 learning demo: read raw exports with Spark, run jobs, capture plans
	uv run python -m quickcart.lakehouse.learning.demo

bronze: ## Phase 4: load Bronze Delta tables from raw exports
	uv run python -m quickcart.lakehouse.pipeline bronze

silver: ## Phase 4: build Silver tables (cleans + quarantine) from Bronze
	uv run python -m quickcart.lakehouse.pipeline silver

gold: ## Phase 4: build the five Gold marts from Silver
	uv run python -m quickcart.lakehouse.pipeline gold

lakehouse: ## Phase 4: full Bronze -> Silver -> Gold pipeline (stops on quality-gate failure)
	uv run python -m quickcart.lakehouse.pipeline all

storage-up: ## Phase 6: start SeaweedFS (storage profile) and create the lakehouse bucket
	docker compose --profile storage up -d
	infrastructure/seaweedfs/bootstrap_bucket.sh

storage-down: ## Stop SeaweedFS
	docker compose --profile storage down

streaming-up: ## Phase 7: start Redpanda + console (streaming profile) and create topics
	docker compose --profile streaming up -d
	docker exec quickcart-redpanda-1 rpk topic create quickcart.order-events.v1 --partitions 3 --replicas 1 || true
	docker exec quickcart-redpanda-1 rpk topic create quickcart.app-events.v1 --partitions 3 --replicas 1 || true
	docker exec quickcart-redpanda-1 rpk topic create quickcart.rider-events.v1 --partitions 3 --replicas 1 || true

streaming-down: ## Stop Redpanda
	docker compose --profile streaming down

stream-consumer: ## Phase 7: run the Structured Streaming consumer (long-running; Ctrl-C to stop)
	uv run python -m quickcart.ingestion.streaming

stream-consumer-once: ## Phase 7: consume one micro-batch then exit (smoke test)
	uv run python -m quickcart.ingestion.streaming --once

simulator-live: ## Phase 7: publish live order events (--rate orders/sec, --orders total)
	uv run python -m quickcart.simulator.realtime --rate 2 --orders 50
