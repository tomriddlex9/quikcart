"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Copy, ExternalLink, FlaskConical } from "lucide-react";
import { ApiBanner } from "@/components/api-banner";
import { Pill, StatusDot } from "@/components/pill";
import { EmptyState, Loading } from "@/components/states";
import { DEMO_SYSTEM_STATUS } from "@/lib/demo";
import { useApiData } from "@/lib/use-api";
import type { SystemStatus } from "@/lib/types";

function statusTone(status: string): "green" | "amber" | "neutral" | "red" {
  const s = status.toLowerCase();
  if (s.includes("complete") || s.includes("done") || s === "up") return "green";
  if (s.includes("progress") || s.includes("partial")) return "amber";
  if (s.includes("fail") || s.includes("error")) return "red";
  return "neutral";
}

function tablePresent(value: unknown): { label: string; present: boolean | null } {
  if (typeof value === "boolean") return { label: String(value), present: value };
  if (typeof value === "number") return { label: `${value} rows`, present: value > 0 };
  if (value === null || value === undefined) return { label: "unknown", present: null };
  return { label: String(value), present: Boolean(value) };
}

const KNOWN_SERVICES = ["postgres", "redpanda", "qdrant", "mlflow"] as const;
const SERVICE_BLURB: Record<string, string> = {
  postgres: "operational source",
  redpanda: "event broker",
  qdrant: "vector retrieval",
  mlflow: "experiment tracking",
  debezium: "change data capture",
  airflow: "batch orchestration",
  seaweedfs: "S3 object store",
};

function serviceChips(services: Record<string, string>) {
  const names = [
    ...KNOWN_SERVICES.filter((s) => s in services),
    ...Object.keys(services).filter((s) => !(KNOWN_SERVICES as readonly string[]).includes(s)),
  ];
  return names.map((name) => {
    const up = (services[name] ?? "down").toLowerCase() === "up";
    return { name, up, blurb: SERVICE_BLURB[name] ?? "service" };
  });
}

export function PipelineStatus() {
  const status = useApiData<SystemStatus>("/api/v1/system/status", DEMO_SYSTEM_STATUS, 30_000);
  const [copied, setCopied] = useState(false);
  const demo = status.mode !== "live";
  const data = status.data;

  return (
    <>
      {demo ? <ApiBanner mode={status.mode} error={status.error} /> : null}

      {data === null ? (
        <Loading label="Waiting for /api/v1/system/status…" />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(["postgres", "redpanda", "qdrant", "mlflow"] as const).map((svc) => {
              const up = (data.services?.[svc] ?? "down").toLowerCase() === "up";
              return (
                <div key={svc} className="panel px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-paper-dim">{svc}</span>
                    <Pill tone={up ? "green" : "red"}>
                      <StatusDot tone={up ? "green" : "red"} />
                      {up ? "up" : "down"}
                    </Pill>
                  </div>
                  <div className="mt-1 text-[10px] text-faint">
                    {svc === "postgres"
                      ? "operational source"
                      : svc === "redpanda"
                        ? "event broker"
                        : svc === "qdrant"
                          ? "vector retrieval"
                          : "experiment tracking"}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="panel px-4 py-4">
            <h2 className="mb-3 text-[12px] font-medium text-paper-dim">Gold marts on disk</h2>
            {Object.keys(data.data_root_tables ?? {}).length === 0 ? (
              <EmptyState
                title="No gold tables reported"
                hint="Run the lakehouse pipeline (make export-raw, then the Bronze→Silver→Gold jobs) so the data root has gold marts."
              />
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(data.data_root_tables).map(([name, value]) => {
                  const t = tablePresent(value);
                  return (
                    <div
                      key={name}
                      className="flex items-center justify-between border border-line-soft px-3 py-2"
                    >
                      <code className="text-[11px] text-paper-dim">{name}</code>
                      <span
                        className={`text-[10.5px] ${
                          t.present === true
                            ? "text-teal"
                            : t.present === false
                              ? "text-faint"
                              : "text-muted"
                        }`}
                      >
                        {t.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="panel px-4 py-4">
            <h2 className="mb-3 text-[12px] font-medium text-paper-dim">
              Phase checklist
              <span className="ml-2 text-[10.5px] font-normal text-faint">
                parsed from <code>kit/TASKS.md</code> at API startup
              </span>
            </h2>
            {(data.phases ?? []).length === 0 ? (
              <EmptyState title="No phase data" hint="The API could not parse kit/TASKS.md." />
            ) : (
              <ol className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
                {data.phases.map((p) => (
                  <li
                    key={String(p.phase)}
                    className="flex items-center gap-2.5 border-b border-line-soft/50 py-2 text-[12px] last:border-0"
                  >
                    <StatusDot tone={statusTone(p.status)} />
                    <span className="w-6 shrink-0 text-faint">
                      {String(p.phase).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-paper-dim">{p.name}</span>
                    <span className="shrink-0 text-[10.5px] text-faint">{p.status}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="panel px-4 py-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[12px] font-medium text-paper-dim">Data quality & quarantine</h2>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(JSON.stringify(data, null, 2))
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
                className="flex items-center gap-1.5 border border-line px-2.5 py-1 text-[10.5px] text-muted transition-colors hover:text-paper"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-teal" strokeWidth={1.75} /> copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" strokeWidth={1.75} /> copy health JSON
                  </>
                )}
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {serviceChips(data.services ?? {}).map(({ name, up, blurb }) => (
                <Pill key={name} tone={up ? "green" : "red"}>
                  <StatusDot tone={up ? "green" : "red"} />
                  {name}
                  <span className="text-faint">· {blurb}</span>
                </Pill>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-line-soft pt-3.5">
              <div className="flex max-w-[75ch] items-start gap-2.5">
                <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber" strokeWidth={1.75} />
                <div className="text-[12px] leading-relaxed text-paper-dim">
                  Rows that fail validation never disappear — they are quarantined with structured
                  error codes. After each pipeline run,{" "}
                  <code className="text-amber/90">data/quarantine/quality_summary</code> records
                  what was rejected and why: the quality rule that fired, the source batch, row
                  counts per check, and a pointer to the full quarantined rows so nothing is lost.
                  Review it to tell a real data problem apart from a schema drift.
                </div>
              </div>
              <Link
                href="/streamlit"
                className="flex shrink-0 items-center gap-1.5 rounded-xs border border-line px-3 py-1.5 text-[11.5px] text-muted transition-colors hover:text-paper"
              >
                open Streamlit Pipeline page{" "}
                <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
              </Link>
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
              In the Streamlit dashboard (:8501) pick the Pipeline page from the sidebar — it lists
              run timings, per-check pass/fail and the quarantine summary from the same directory.{" "}
              <span className="text-muted">
                “copy health JSON” copies the raw /api/v1/system/status payload above to your
                clipboard for tickets and runbooks.
              </span>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
