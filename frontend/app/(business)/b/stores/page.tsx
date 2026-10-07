"use client";

import { BusinessPage } from "@/components/business/business-page";
import { Spotlight } from "@/components/business/spotlight";
import { StoreLeaderboard } from "@/components/business/store-leaderboard";
import type { StoreScorecardsResponse } from "@/lib/business/types";
import { useBusinessData } from "@/lib/business/use-business-api";

export default function StoresPage() {
  const query = useBusinessData<StoreScorecardsResponse>("/stores/scorecards");
  return (
    <BusinessPage
      title="Stores"
      description="Every store you can see. The ones that need the most help are at the top."
      query={query}
    >
      {(data) => (
        <div className="space-y-2">
          {data.meta.note ? <p className="text-xs text-muted-foreground">{data.meta.note}</p> : null}
          <Spotlight journeyId="stores">
            <StoreLeaderboard stores={data.stores} />
          </Spotlight>
        </div>
      )}
    </BusinessPage>
  );
}
