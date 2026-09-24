import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Status chip used across the operations pages. Kept as a thin wrapper over the
 * shadcn Badge so existing `tone` call sites read the same while the palette
 * comes from the theme tokens.
 */
const TONES = {
  neutral: "bg-secondary text-secondary-foreground",
  amber: "bg-chart-3/12 text-chart-3",
  teal: "bg-chart-2/12 text-chart-2",
  red: "bg-destructive/12 text-destructive",
  green: "bg-chart-2/12 text-chart-2",
} as const;

export type PillTone = keyof typeof TONES;

export function Pill({
  tone = "neutral",
  children,
  className,
}: {
  tone?: PillTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Badge variant="secondary" className={cn("gap-1.5 font-normal", TONES[tone], className)}>
      {children}
    </Badge>
  );
}

export function StatusDot({ tone }: { tone: PillTone }) {
  const color =
    tone === "green" || tone === "teal"
      ? "bg-chart-2"
      : tone === "red"
        ? "bg-destructive"
        : tone === "amber"
          ? "bg-chart-3"
          : "bg-muted-foreground";
  return <span className={cn("inline-block size-1.5 rounded-full", color)} aria-hidden />;
}
