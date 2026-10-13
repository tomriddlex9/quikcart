"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";

import "leaflet/dist/leaflet.css";

export interface MapPoint {
  id: number;
  label: string;
  detail: string;
  latitude: number;
  longitude: number;
  /** Fixed colour: Leaflet writes SVG attributes, where CSS variables do not resolve. */
  color: string;
  /** 0..1, scales the circle. */
  size: number;
}

export function NetworkMapLeaflet({ points }: { points: MapPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const map = L.map(node, { scrollWheelZoom: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const bounds = L.latLngBounds([]);
    for (const p of points) {
      const latLng: L.LatLngExpression = [p.latitude, p.longitude];
      bounds.extend(latLng);
      L.circleMarker(latLng, {
        radius: 7 + Math.round(p.size * 7),
        color: p.color,
        fillColor: p.color,
        fillOpacity: 0.55,
        weight: 2,
      })
        .bindTooltip(`<strong>${p.label}</strong><br/>${p.detail}`, { direction: "top" })
        .addTo(map);
    }
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });

    return () => {
      map.remove();
    };
  }, [points]);

  return <div ref={containerRef} className="h-full w-full" />;
}
