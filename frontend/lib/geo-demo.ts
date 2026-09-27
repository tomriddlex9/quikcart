import type { GeoStore } from "./types";

/** Mirrors backend `demo_geo_stores()` — used when `/api/v1/geo/stores` is offline. */
const DEMO_CITIES: Array<[string, number, number]> = [
  ["Mumbai", 19.076, 72.877],
  ["Delhi", 28.613, 77.209],
  ["Bengaluru", 12.972, 77.594],
  ["Hyderabad", 17.385, 78.487],
  ["Pune", 18.52, 73.856],
  ["Chennai", 13.083, 80.27],
  ["Kolkata", 22.573, 88.364],
  ["Gurugram", 28.459, 77.026],
  ["Jaipur", 26.912, 75.787],
  ["Ahmedabad", 23.023, 72.571],
];

export const DEMO_GEO_STORES: GeoStore[] = DEMO_CITIES.map(([city, latitude, longitude], index) => ({
  store_id: index + 1,
  name: `QuickCart ${city}`,
  city,
  latitude,
  longitude,
  demo: true,
}));
