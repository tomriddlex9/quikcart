"use client";

import { CategoryHome } from "@/components/business/homes/category-home";
import { CityHome } from "@/components/business/homes/city-home";
import { ExecHome } from "@/components/business/homes/exec-home";
import { LeadershipHome } from "@/components/business/homes/leadership-home";
import { StoreHome } from "@/components/business/homes/store-home";
import { useBusiness } from "@/lib/business/business-context";

export default function TodayPage() {
  const { personaView } = useBusiness();

  switch (personaView.homeId) {
    case "city_pacing":
      return <CityHome />;
    case "store_shift":
      return <StoreHome />;
    case "category_matrix":
      return <CategoryHome />;
    case "narrative_digest":
      return <LeadershipHome />;
    case "exec_scorecard":
    default:
      return <ExecHome />;
  }
}
