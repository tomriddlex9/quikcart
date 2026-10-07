import Link from "next/link";
import { AskAboutButton } from "@/components/business/ask-about-button";
import { StatusBadge } from "@/components/business/status-badge";
import type { AttentionItem } from "@/lib/business/types";

export function AttentionList({
  items,
  emptyText = "Nothing needs your attention right now.",
}: {
  items: AttentionItem[];
  emptyText?: string;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
        {emptyText}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      {items.map((item) => (
        <li key={item.id} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                status={item.severity}
                label={item.severity === "bad" ? "Needs help" : "Keep an eye"}
              />
              {item.store_id !== null ? (
                <Link
                  href={`/b/stores/${item.store_id}`}
                  className="text-sm font-medium hover:underline"
                >
                  {item.title}
                </Link>
              ) : (
                <span className="text-sm font-medium">{item.title}</span>
              )}
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">{item.detail}</p>
          </div>
          <AskAboutButton question={`What should I do about: ${item.title}?`} label="Ask what to do" />
        </li>
      ))}
    </ul>
  );
}
