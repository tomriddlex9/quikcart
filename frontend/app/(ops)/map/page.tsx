import type { Metadata } from "next";
import { MapConsole } from "@/components/map/map-console";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "Map",
};

export default function MapPage() {
  return (
    <>
      <PageHeader
        title="Map"
        description="Geographic view of active stores with OpenStreetMap basemap. When external raw partitions exist, weather and traffic chips attach per store from the same feeds used on Logs."
      />
      <MapConsole />
    </>
  );
}
