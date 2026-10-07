import { StatusBadge } from "@/components/business/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  AssistantCard,
  CompareCard,
  KpiCard,
  ProposalCard,
  RiskListCard,
  SeriesPoint,
  TableCard,
  TrendCard,
} from "@/lib/assistant/types";
import { cn } from "@/lib/utils";

const PROPOSAL_STATUS: Record<string, string> = {
  PENDING: "Waiting for your approval",
  APPROVED: "Approved",
  REJECTED: "Declined",
  EXECUTED: "Done",
};

function humanize(key: string): string {
  const spaced = key.replace(/_/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function Delta({ text }: { text: string | null }) {
  if (!text) return null;
  return <span className="text-xs text-muted-foreground">{text}</span>;
}

function Kpi({ card }: { card: KpiCard }) {
  return (
    <Card size="sm" data-card="kpi">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{card.label}</CardTitle>
          <StatusBadge status={card.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-2xl font-semibold tabular-nums tracking-tight">{card.display}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <Delta text={card.delta_display} />
          {card.compare_label ? <span>{card.compare_label}</span> : null}
          {card.baseline_display ? <span>(was {card.baseline_display})</span> : null}
        </p>
        {card.explanation ? <p className="text-sm text-muted-foreground">{card.explanation}</p> : null}
        {card.note ? <p className="text-sm">{card.note}</p> : null}
      </CardContent>
    </Card>
  );
}

function Sparkline({ points, label }: { points: SeriesPoint[]; label: string }) {
  const usable = points.filter((p): p is SeriesPoint & { value: number } => p.value !== null);
  if (usable.length < 2) return null;
  const W = 240;
  const H = 56;
  const values = usable.map((p) => p.value);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const coords = usable.map((p, i) => {
    const x = (i / (usable.length - 1)) * W;
    const y = H - 4 - ((p.value - min) / span) * (H - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-14 w-full text-chart-1"
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Trend({ card }: { card: TrendCard }) {
  const first = card.points[0];
  const last = card.points[card.points.length - 1];
  return (
    <Card size="sm" data-card="trend">
      <CardHeader>
        <CardTitle>{card.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Sparkline points={card.points} label={`${card.title} over time`} />
        {first && last ? (
          <p className="flex justify-between text-xs text-muted-foreground">
            <span>
              {first.at.slice(0, 10)}: {first.display}
            </span>
            <span>
              {last.at.slice(0, 10)}: {last.display}
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing to show yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function Compare({ card }: { card: CompareCard }) {
  return (
    <Card size="sm" data-card="compare">
      <CardHeader>
        <CardTitle>{card.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {card.items.map((item) => (
            <li key={item.ref} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm">{item.label}</span>
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold tabular-nums">{item.display}</span>
                <Delta text={item.delta_display} />
                <StatusBadge status={item.status} />
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Table({ card }: { card: TableCard }) {
  return (
    <Card size="sm" data-card="table">
      <CardHeader>
        <CardTitle>{card.title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {card.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rows to show.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                {card.columns.map((c) => (
                  <th key={c} scope="col" className="py-1.5 pr-3 font-medium">
                    {humanize(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {card.rows.map((row, i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  {card.columns.map((c) => (
                    <td key={c} className="py-1.5 pr-3 tabular-nums">
                      {cell(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function RiskList({ card }: { card: RiskListCard }) {
  return (
    <Card size="sm" data-card="risk_list">
      <CardHeader>
        <CardTitle>{card.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {card.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing needs attention right now.</p>
        ) : (
          <ul className="space-y-2">
            {card.items.map((item, i) => (
              <li key={item.ref ?? `${item.title}-${i}`} className="flex items-start gap-2">
                <StatusBadge
                  status={item.severity}
                  label={item.severity === "bad" ? "Needs help" : "Keep an eye on"}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  <span className="font-medium">{item.title}</span>
                  {item.detail ? <span className="text-muted-foreground"> — {item.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Proposal({ card }: { card: ProposalCard }) {
  const status = PROPOSAL_STATUS[card.status.toUpperCase()] ?? humanize(card.status.toLowerCase());
  return (
    <Card size="sm" data-card="proposal">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{card.title}</CardTitle>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">{status}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {card.detail ? <p className="text-sm">{card.detail}</p> : null}
        <p className="text-xs text-muted-foreground">
          This is only a suggestion. A person approves it before anything changes.
        </p>
      </CardContent>
    </Card>
  );
}

/** Renders one hydrated assistant card in plain language. */
export function AnswerCard({ card, className }: { card: AssistantCard; className?: string }) {
  let body: React.ReactNode;
  switch (card.type) {
    case "kpi":
      body = <Kpi card={card} />;
      break;
    case "trend":
      body = <Trend card={card} />;
      break;
    case "compare":
      body = <Compare card={card} />;
      break;
    case "table":
      body = <Table card={card} />;
      break;
    case "risk_list":
      body = <RiskList card={card} />;
      break;
    case "proposal":
      body = <Proposal card={card} />;
      break;
    default:
      return null;
  }
  return <div className={cn("w-full", className)}>{body}</div>;
}
