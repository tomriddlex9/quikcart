"use client";

import dynamic from "next/dynamic";
import { CloudSun, MapPin, TrafficCone } from "lucide-react";
import { ApiBanner } from "@/components/api-banner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEMO_GEO_STORES } from "@/lib/geo-demo";
import type { GeoStore } from "@/lib/types";
import { useApiData } from "@/lib/use-api";

const StoreMapLeaflet = dynamic(
  () => import("@/components/map/store-map-leaflet").then((m) => m.StoreMapLeaflet),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full place-items-center text-xs text-muted-foreground">
        Loading map…
      </div>
    ),
  },
);

function weatherChip(store: GeoStore): string | null {
  const w = store.weather;
  if (!w?.condition && w?.temperature_c == null) return null;
  const parts: string[] = [];
  if (w.condition) parts.push(w.condition);
  if (w.temperature_c != null) parts.push(`${w.temperature_c.toFixed(0)}°C`);
  return parts.join(" · ");
}

function trafficChip(store: GeoStore): string | null {
  const delay = store.traffic?.eta_delay_sec;
  if (delay == null) return null;
  const min = Math.round(delay / 60);
  return min > 0 ? `+${min}m delay` : "Clear";
}

export function MapConsole() {
  const { data, mode, error } = useApiData<GeoStore[]>("/api/v1/geo/stores", DEMO_GEO_STORES, 60_000);
  const stores = data ?? DEMO_GEO_STORES;

  return (
    <div className="space-y-4">
      <ApiBanner mode={mode} error={error} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Store footprint</CardTitle>
            <CardDescription>
              OpenStreetMap tiles (zero-cost). Markers from Postgres{" "}
              <code className="text-xs">stores</code> when the API is live.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[min(62vh,520px)] min-h-[320px] w-full border border-border/60 bg-muted/20">
              <StoreMapLeaflet stores={stores} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Stores ({stores.length})</CardTitle>
            <CardDescription>Optional weather and traffic summaries from raw feeds.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="max-h-[min(62vh,520px)] space-y-2 overflow-y-auto pr-1">
              {stores.map((store) => {
                const weather = weatherChip(store);
                const traffic = trafficChip(store);
                return (
                  <li
                    key={store.store_id}
                    className="rounded-lg border border-border/70 bg-card/80 px-3 py-2.5 text-sm"
                  >
                    <div className="flex items-start gap-2">
                      <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{store.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {store.city} · {store.latitude.toFixed(3)}, {store.longitude.toFixed(3)}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {store.demo ? (
                            <Badge variant="outline" className="text-[10px]">
                              demo
                            </Badge>
                          ) : null}
                          {weather ? (
                            <Badge variant="secondary" className="gap-1 text-[10px]">
                              <CloudSun className="size-3" />
                              {weather}
                            </Badge>
                          ) : null}
                          {traffic ? (
                            <Badge variant="secondary" className="gap-1 text-[10px]">
                              <TrafficCone className="size-3" />
                              {traffic}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
