import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TRUST_STEPS } from "@/lib/learn/architecture";

export function TrustCallout() {
  return (
    <Card className="border-[color:var(--chart-4)]/40">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-[color:var(--chart-4)]" strokeWidth={1.75} />
          <CardTitle>Trust boundary</CardTitle>
          <Badge variant="outline" className="ml-auto">
            the only write path back into Postgres
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-foreground">
          Gold, the vector index and the language model are readers.{" "}
          <strong className="font-medium">The agent proposes. A human approves. One PostgreSQL
          transaction executes it.</strong>{" "}
          Nothing skips that sequence — see the dashed arc on the diagram above.
        </p>
        <ol className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {TRUST_STEPS.map((step, index) => (
            <li key={step} className="flex gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
              <span className="shrink-0 text-foreground">{index + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
