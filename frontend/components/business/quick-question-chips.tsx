import Link from "next/link";
import { askHref } from "@/components/business/ask-about-button";
import { cn } from "@/lib/utils";

export const DEFAULT_QUESTIONS = [
  "How are sales today compared with last week?",
  "Which stores need help right now?",
  "What is about to run out?",
  "Why are deliveries slow?",
];

export function QuickQuestionChips({
  questions = DEFAULT_QUESTIONS,
  className,
}: {
  questions?: string[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap gap-2", className)} aria-label="Suggested questions">
      {questions.map((q) => (
        <li key={q}>
          <Link
            href={askHref(q)}
            className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-secondary"
          >
            {q}
          </Link>
        </li>
      ))}
    </ul>
  );
}
