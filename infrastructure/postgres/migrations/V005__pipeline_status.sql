-- V005 — pipeline_status heartbeats for the live worker (QuickCart live demo)
-- One row per pipeline stage. Upserted by the live worker after each step.

CREATE TABLE IF NOT EXISTS pipeline_status (
    stage           TEXT PRIMARY KEY
        CHECK (stage IN (
            'order_events_bronze',
            'cdc_bronze',
            'cdc_silver',
            'gold_refresh',
            'ml_scoring',
            'anomaly_detect',
            'worker'
        )),
    last_run_at     TIMESTAMPTZ,
    rows_in         BIGINT NOT NULL DEFAULT 0,
    rows_out        BIGINT NOT NULL DEFAULT 0,
    lag_seconds     DOUBLE PRECISION,
    error           TEXT,
    detail          JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE pipeline_status IS
    'Live worker heartbeats: stage progress, lag, and last error for /api/v1/live/pipeline.';
