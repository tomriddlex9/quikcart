// Phase list mirrored from kit/03_IMPLEMENTATION_PLAN.md headings.
// Used by /logs to render the checklist returned by /api/v1/system/status.

export interface PhaseInfo {
  phase: number;
  name: string;
}

export const PHASES: PhaseInfo[] = [
  { phase: 0, name: "Repository and developer environment" },
  { phase: 1, name: "PostgreSQL + deterministic simulator" },
  { phase: 2, name: "SQL analytics foundation" },
  { phase: 3, name: "PySpark fundamentals" },
  { phase: 4, name: "Delta Lake and Medallion MVP" },
  { phase: 5, name: "Data quality, CDC merges, SCD2, Spark optimization" },
  { phase: 6, name: "S3-compatible object storage" },
  { phase: 7, name: "Streaming with Redpanda" },
  { phase: 8, name: "PostgreSQL CDC with Debezium" },
  { phase: 9, name: "Airflow orchestration" },
  { phase: 10, name: "Analytics dashboard" },
  { phase: 11, name: "Classic ML + MLflow" },
  { phase: 12, name: "RAG" },
  { phase: 13, name: "LangGraph agent" },
  { phase: 14, name: "FastAPI + human-approved action flow" },
  { phase: 15, name: "Engineering hardening + final demo" },
];

export const PHASE_NAMES: Record<number, string> = Object.fromEntries(
  PHASES.map((p) => [p.phase, p.name]),
);
