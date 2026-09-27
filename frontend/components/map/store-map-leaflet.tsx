"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import type { GeoStore } from "@/lib/types";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

import "leaflet/dist/leaflet.css";

const defaultIcon = L.icon({
  iconUrl: markerIcon.src,
  iconRetinaUrl: markerIcon2x.src,
  shadowUrl: markerShadow.src,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function formatWeather(store: GeoStore): string | null {
  const w = store.weather;
  if (!w?.condition && w?.temperature_c == null) return null;
  const parts: string[] = [];
  if (w.condition) parts.push(w.condition);
  if (w.temperature_c != null) parts.push(`${w.temperature_c.toFixed(1)}°C`);
  return parts.join(" · ");
}

function formatTraffic(store: GeoStore): string | null {
  const t = store.traffic;
  if (t?.eta_delay_sec == null) return null;
  const minutes = Math.round(t.eta_delay_sec / 60);
  return minutes > 0 ? `+${minutes} min ETA delay` : "On-time ETA";
}

function popupHtml(store: GeoStore): string {
  const weather = formatWeather(store);
  const traffic = formatTraffic(store);
  const lines = [
    `<strong>${escapeHtml(store.name)}</strong>`,
    `<span>${escapeHtml(store.city)}</span>`,
  ];
  if (weather) lines.push(`Weather: ${escapeHtml(weather)}`);
  if (traffic) lines.push(`Traffic: ${escapeHtml(traffic)}`);
  return `<div style="font-size:13px;line-height:1.4">${lines.join("<br/>")}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function StoreMapLeaflet({ stores }: { stores: GeoStore[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || mapRef.current) return;

    const map = L.map(node, { scrollWheelZoom: true }).setView([20.5937, 78.9629], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = markersRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    if (stores.length === 0) return;

    const bounds = L.latLngBounds([]);
    for (const store of stores) {
      const latLng: L.LatLngExpression = [store.latitude, store.longitude];
      bounds.extend(latLng);
      L.marker(latLng, { icon: defaultIcon })
        .bindPopup(popupHtml(store))
        .addTo(layer);
    }
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 12 });
  }, [stores]);

  return <div ref={containerRef} className="h-full w-full rounded-lg" />;
}
