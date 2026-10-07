import { cn } from "@/lib/utils";

export const RARE_UI_URL = "https://www.rareui.com";

/** Attribution for the Matrix Orb's visual inspiration. */
export function RareUiCredit({ className }: { className?: string }) {
  return (
    <p className={cn("text-[11px] text-muted-foreground", className)}>
      Orb inspired by{" "}
      <a
        href={RARE_UI_URL}
        target="_blank"
        rel="noreferrer noopener"
        className="underline underline-offset-2 hover:text-foreground"
      >
        Rare UI
      </a>
    </p>
  );
}
