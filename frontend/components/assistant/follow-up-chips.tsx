"use client";

export function FollowUpChips({
  items,
  onPick,
  disabled,
}: {
  items: string[];
  onPick: (question: string) => void;
  disabled?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested follow-up questions">
      {items.map((q) => (
        <button
          key={q}
          type="button"
          disabled={disabled}
          onClick={() => onPick(q)}
          className="rounded-full border border-border bg-card px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          {q}
        </button>
      ))}
    </div>
  );
}
