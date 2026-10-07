import Link from "next/link";
import { MessageCircleQuestion } from "lucide-react";
import { cn } from "@/lib/utils";

/** Build `/b/ask` URL with question + optional structured context for the assistant. */
export function askHref(question: string, context?: Record<string, string>): string {
  const params = new URLSearchParams({ q: question });
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      if (value) params.set(`ctx_${key}`, value);
    }
  }
  return `/b/ask?${params.toString()}`;
}

export function AskAboutButton({
  question,
  label = "Ask about this",
  className,
  context,
}: {
  question: string;
  label?: string;
  className?: string;
  /** Optional structured hints (metric key, store id, …) passed as `ctx_*` query params. */
  context?: Record<string, string>;
}) {
  return (
    <Link
      href={askHref(question, context)}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        className,
      )}
    >
      <MessageCircleQuestion className="size-3.5" aria-hidden />
      {label}
    </Link>
  );
}
