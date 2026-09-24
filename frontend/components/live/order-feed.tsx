import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill, type PillTone } from "@/components/pill";
import { EmptyState } from "@/components/states";
import { formatINR } from "@/lib/format";
import type { LiveOrderRow } from "@/lib/live-types";

function statusTone(status: string): PillTone {
  const normalized = status.toLowerCase();
  if (normalized.includes("fail") || normalized.includes("cancel")) return "red";
  if (normalized.includes("deliver") || normalized.includes("complete")) return "green";
  if (normalized.includes("placed") || normalized.includes("confirm")) return "teal";
  return "amber";
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function OrderFeed({ orders }: { orders: LiveOrderRow[] }) {
  return (
    <Card size="sm" className="h-full">
      <CardHeader>
        <CardTitle className="text-sm">Recent orders</CardTitle>
        <span className="col-start-2 row-start-1 text-xs tabular-nums text-muted-foreground">
          {orders.length} events
        </span>
      </CardHeader>
      <CardContent aria-live="polite">
        {orders.length === 0 ? (
          <EmptyState
            className="py-10"
            title="Waiting for order events"
            hint="New orders appear here as the simulator publishes them."
          />
        ) : (
          <div className="divide-y divide-border">
            {orders.map((order) => (
              <div
                key={`${order.order_id}-${order.placed_at}-${order.status}`}
                className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[1fr_auto_auto]"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium tabular-nums">
                    Order #{order.order_id}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Store {order.store_id}
                    {order.customer_id != null ? ` · Customer ${order.customer_id}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm tabular-nums">{formatINR(order.total_amount)}</div>
                  <div className="text-[11px] tabular-nums text-muted-foreground">
                    {formatTime(order.placed_at)}
                  </div>
                </div>
                <Pill
                  tone={statusTone(order.status)}
                  className="col-span-2 w-fit sm:col-span-1 sm:row-start-1 sm:self-center"
                >
                  {order.status.replaceAll("_", " ").toLowerCase()}
                </Pill>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
