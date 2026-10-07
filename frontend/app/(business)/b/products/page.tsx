"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BusinessPage } from "@/components/business/business-page";
import { Spotlight } from "@/components/business/spotlight";
import { ProductList } from "@/components/business/product-list";
import type { ProductTab, ProductsResponse } from "@/lib/business/types";
import { useBusinessData } from "@/lib/business/use-business-api";
import { cn } from "@/lib/utils";

const TABS: { id: ProductTab; label: string }[] = [
  { id: "running_low", label: "Running low" },
  { id: "bestsellers", label: "Bestsellers" },
  { id: "slow", label: "Slow movers" },
];

function ProductsView() {
  const router = useRouter();
  const raw = useSearchParams().get("tab");
  const tab: ProductTab = raw === "bestsellers" || raw === "slow" ? raw : "running_low";
  const query = useBusinessData<ProductsResponse>(`/products?tab=${tab}`);
  return (
    <BusinessPage
      title="Products"
      description={query.data?.description ?? "What is selling, what is slow, and what is about to run out."}
      query={query}
      actions={
        <div role="tablist" aria-label="Product views" className="inline-flex rounded-lg bg-muted p-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              onClick={() => router.replace(`/b/products?tab=${t.id}`)}
              className={cn(
                "rounded-md px-3 py-1 text-[13px] transition-colors",
                tab === t.id
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      }
    >
      {(data) => (
        <Spotlight journeyId="products">
          <ProductList items={data.items} emptyText={`Nothing under “${data.title}” right now.`} />
        </Spotlight>
      )}
    </BusinessPage>
  );
}

export default function ProductsPage() {
  return (
    <Suspense>
      <ProductsView />
    </Suspense>
  );
}
