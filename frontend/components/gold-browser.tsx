"use client";

import { ApiBanner } from "@/components/api-banner";
import { Pill, StatusDot } from "@/components/pill";
import { EmptyState, Skeleton } from "@/components/states";
import { DEMO_SYSTEM_STATUS } from "@/lib/demo";
import { GOLD_MARTS } from "@/lib/gold-marts";
import { useApiData } from "@/lib/use-api";
import type { SystemStatus } from "@/lib/types";

function tablePresence(value: unknown): { label: string; state: "present" | "absent" | "unknown" } {
  if (typeof value === "boolean")
    return { label: value ? "on disk" : "not built", state: value ? "present" : "absent" };
  if (typeof value === "number")
    return { label: value > 0 ? `${value} rows` : "empty", state: value > 0 ? "present" : "absent" };
  return { label: "not probed", state: "unknown" };
}

/** Bronze → Silver → Gold medallion diagram, drawn in the console palette. */
function MedallionDiagram() {
  const layers = [
    {
      name: "BRONZE",
      sub: "raw payloads + ingestion metadata",
      fill: "#1a1410",
      stroke: "#5c4632",
      text: "#c99a6b",
      x: 12,
    },
    {
      name: "SILVER",
      sub: "validated, conformed entities",
      fill: "#14171d",
      stroke: "#3d4653",
      text: "#9aa5b4",
      x: 262,
    },
    {
      name: "GOLD",
      sub: "analysis-ready marts",
      fill: "#191510",
      stroke: "#8a6a2a",
      text: "#f2a93b",
      x: 512,
    },
  ];
  return (
    <svg
      viewBox="0 0 760 118"
      className="w-full"
      role="img"
      aria-label="Medallion architecture: Bronze to Silver to Gold"
    >
      {layers.map((l, i) => (
        <g key={l.name}>
          <rect
            x={l.x}
            y={22}
            width={236}
            height={74}
            rx={3}
            fill={l.fill}
            stroke={l.stroke}
            strokeWidth={1}
          />
          <text
            x={l.x + 14}
            y={48}
            fill={l.text}
            fontSize={13}
            fontFamily="var(--font-mono)"
            letterSpacing={2}
          >
            {l.name}
          </text>
          <text
            x={l.x + 14}
            y={68}
            fill="#8b94a3"
            fontSize={10}
            fontFamily="var(--font-mono)"
          >
            {l.sub}
          </text>
          {i < layers.length - 1 ? (
            <g>
              <line
                x1={l.x + 240}
                y1={59}
                x2={l.x + 244}
                y2={59}
                stroke="#5b6575"
                strokeWidth={1}
              />
              <path
                d={`M ${l.x + 244} 55 L ${l.x + 244} 63 M ${l.x + 241} 60 L ${l.x + 246} 60`}
                stroke="#5b6575"
                strokeWidth={1}
              />
              <path
                d={`M ${l.x + 246} 59 l -5 -3.5 v 7 z`}
                fill="#5b6575"
              />
            </g>
          ) : null}
        </g>
      ))}
      <text x={12} y={112} fill="#5b6575" fontSize={9.5} fontFamily="var(--font-mono)">
        bad rows never disappear — they are quarantined with structured error codes
      </text>
    </svg>
  );
}

export function GoldBrowser() {
  const status = useApiData<SystemStatus>("/api/v1/system/status", DEMO_SYSTEM_STATUS, 30_000);
  const demo = status.mode !== "live";
  const tables = status.data?.data_root_tables ?? {};

  return (
    <>
      {demo ? <ApiBanner mode={status.mode} error={status.error} /> : null}

      {status.data === null ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[260px] rounded-xs border border-line-soft" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <section className="panel px-4 py-4">
            <h2 className="mb-3 text-[12px] font-medium text-paper-dim">Medallion architecture</h2>
            <MedallionDiagram />
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[11px] font-medium tracking-wide text-faint">gold marts</h2>
              <span className="text-[10px] text-faint">
                presence probed by the API at <code>data/gold/*</code> · polled every 30s
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {GOLD_MARTS.map((mart) => {
                const presence = tablePresence(tables[mart.name]);
                const tone =
                  presence.state === "present" ? "teal" : presence.state === "absent" ? "neutral" : "amber";
                return (
                  <article key={mart.name} className="panel px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="text-[12.5px] text-paper">{mart.name}</code>
                      <Pill tone={mart.family === "ml" ? "amber" : "neutral"}>
                        {mart.family === "ml" ? "ML write-back" : "pipeline mart"}
                      </Pill>
                      <Pill tone={tone}>
                        <StatusDot tone={presence.state === "present" ? "green" : presence.state === "absent" ? "neutral" : "amber"} />
                        {presence.label}
                      </Pill>
                    </div>

                    <dl className="mt-3 space-y-2 text-[11.5px] leading-relaxed">
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-faint">grain</dt>
                        <dd className="text-paper-dim">{mart.grain}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-faint">key columns</dt>
                        <dd className="flex flex-wrap gap-1">
                          {mart.keyColumns.map((c) => (
                            <code
                              key={c}
                              className="border border-line-soft bg-ink px-1.5 py-0.5 text-[10px] text-teal"
                            >
                              {c}
                            </code>
                          ))}
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-faint">columns</dt>
                        <dd className="text-muted">{mart.columnsNote}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-faint">how it's built</dt>
                        <dd className="text-muted">{mart.howBuilt}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-faint">built by</dt>
                        <dd className="text-muted">{mart.builtBy}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-faint">consumed by</dt>
                        <dd className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted">
                          {mart.consumers.map((c) => (
                            <code key={c} className="text-[10.5px] text-paper-dim">
                              {c}
                            </code>
                          ))}
                        </dd>
                      </div>
                    </dl>

                    {presence.state === "absent" ? (
                      <p className="mt-3 border-t border-line-soft pt-2.5 text-[10.5px] leading-relaxed text-faint">
                        {mart.family === "ml"
                          ? "not built yet — run the corresponding Phase 11 model (it overwrites this table on every run)."
                          : "not built yet — run the Silver→Gold batch job (make gold, or the Airflow DAG in Phase 9)."}
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>

          <EmptyState
            title="Where to inspect the rows themselves"
            hint="The Streamlit dashboard's Pipeline page reads these same Gold tables through the API's readers — open it via the /streamlit tab, or query data/gold/* directly with Spark SQL (delta format)."
          />
        </div>
      )}
    </>
  );
}
