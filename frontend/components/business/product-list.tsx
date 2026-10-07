import { StatusBadge } from "@/components/business/status-badge";
import type { ProductRow } from "@/lib/business/types";

export function ProductList({
  items,
  showStore = true,
  emptyText = "No products to show.",
}: {
  items: ProductRow[];
  showStore?: boolean;
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
      {items.map((p) => (
        <li
          key={`${p.product_id}-${p.store_id ?? "all"}`}
          className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{p.name}</p>
            <p className="text-xs text-muted-foreground">
              {p.category}
              {showStore && p.store_name ? ` · ${p.store_name}` : ""}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">{p.note}</p>
          </div>
          {p.revenue_display ? (
            <span className="text-sm tabular-nums text-muted-foreground">{p.revenue_display}</span>
          ) : null}
          <StatusBadge status={p.status} />
        </li>
      ))}
    </ul>
  );
}
