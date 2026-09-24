// Simulator control contracts. Mirror src/quickcart/live/sim_control.py and
// src/quickcart/api/sim.py — do not invent alternate field names.

export interface SimControlState {
  running: boolean;
  orders_per_minute: number;
  cancel_rate: number;
  payment_fail_rate: number;
  inventory_churn: number;
  rider_ping_hz: number;
  ticket_rate: number;
  burst_factor: number;
}

export interface SimImpactEstimate {
  orders_per_minute_effective: number;
  postgres_rows_per_minute_estimate: number;
  expected_cdc_lag_seconds_hint: number;
  note: string;
}

export interface SimStatus {
  state: SimControlState;
  impact: SimImpactEstimate;
}

export type SimConfigPatch = Partial<SimControlState>;

// Demo data — shown ONLY when the API is unreachable, and always under a
// clearly visible "API offline — demo data" banner.
export const DEMO_SIM_STATUS: SimStatus = {
  state: {
    running: true,
    orders_per_minute: 120,
    cancel_rate: 0.05,
    payment_fail_rate: 0.03,
    inventory_churn: 0.1,
    rider_ping_hz: 1.0,
    ticket_rate: 0.02,
    burst_factor: 1.0,
  },
  impact: {
    orders_per_minute_effective: 120,
    postgres_rows_per_minute_estimate: 720,
    expected_cdc_lag_seconds_hint: 2,
    note:
      "Postgres → Debezium CDC → Bronze; estimate assumes ~6 operational rows" +
      " per order and a typical 2s CDC hop.",
  },
};
