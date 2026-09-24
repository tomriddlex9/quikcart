import type { ReactNode } from "react";

export function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="panel panel-hover px-4 py-3.5">
      <div className="text-[10.5px] tracking-wide text-faint">{label}</div>
      <div className="mt-1.5 font-display text-[24px] font-semibold leading-none tracking-tight text-paper">
        {value}
      </div>
      {hint ? <div className="mt-1.5 text-[10.5px] text-faint">{hint}</div> : null}
    </div>
  );
}
