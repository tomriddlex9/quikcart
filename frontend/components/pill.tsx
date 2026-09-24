import { cn } from "@/lib/cn";

const TONES = {
  neutral: "border-line bg-panel-2 text-muted",
  amber: "border-amber-dim/50 bg-amber/10 text-amber",
  teal: "border-teal-dim/60 bg-teal/10 text-teal",
  red: "border-red-dim/60 bg-red/10 text-red",
  green: "border-green/40 bg-green/10 text-green",
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
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xs border px-2 py-0.5 text-[10.5px] leading-5",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone }: { tone: PillTone }) {
  const color =
    tone === "green"
      ? "bg-green"
      : tone === "red"
        ? "bg-red"
        : tone === "amber"
          ? "bg-amber"
          : tone === "teal"
            ? "bg-teal"
            : "bg-faint";
  return <span className={cn("inline-block h-1.5 w-1.5 rounded-full", color)} />;
}
