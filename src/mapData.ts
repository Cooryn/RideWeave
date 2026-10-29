import type { FeatureCollection, MultiLineString } from "geojson";
import type { StyleSpecification, LayerSpecification } from "maplibre-gl";
import type { Ride } from "./types";
import { DARK_MAP_BACKGROUND, LIGHT_MAP_BACKGROUND } from "./mapTheme";
import { trackContinuity } from "./trackGaps";
import type { PauseLinks } from "./roadMatching";
import {
  ROUTE_COLOR,
  SELECTED_ROUTE_COLOR,
  ROUTE_CASING_COLOR,
  roadLineWidth,
} from "./heatData";

export const RIDES_SOURCE = "rideweave-rides";
export const ROUTES_LAYER = "rideweave-routes";
export const SELECTED_LAYER = "rideweave-selected";
export const ROUTES_CASING_LAYER = "rideweave-routes-casing";
export const SELECTED_CASING_LAYER = "rideweave-selected-casing";
export const HIT_LAYER = "rideweave-hit";
// Both themes share the same layers, sources and road definitions. Theme
// changes only recolor this template; ride overlays keep their own palette.
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export function ridesGeoJSON(
  rides: Ride[],
  pauseLinks?: PauseLinks,
): FeatureCollection<MultiLineString, { rideId: string }> {
  return {
    type: "FeatureCollection",
    features: rides.flatMap((ride) => {
      const { gaps } = trackContinuity(ride.segments);
      const breaks = new Set(gaps.map((g) => g.after[0]));
      const coordinates: number[][][] = [];
      for (const segment of ride.segments) {
        let line: number[][] = [];
        const finish = () => {
          if (line.length >= 2) coordinates.push(line);
          line = [];
        };
        for (const point of segment) {
          if (
            !Number.isFinite(point.lon + point.lat) ||
            Math.abs(point.lon) > 180 ||
            Math.abs(point.lat) > 90
          ) {
            finish();
            continue;
          }
          if (breaks.has(point)) finish();
          line.push([point.lon, point.lat]);
        }
        finish();
      }
      const links = (pauseLinks?.features ?? []).filter(
        (f) => f.properties.rideId === ride.id,
      );
      for (const gap of gaps) {
        const a = gap.before.at(-1)!,
          b = gap.after[0],
          start = [a.lon, a.lat],
          end = [b.lon, b.lat];
        const near = (p: number[], q: number[]) =>
          Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-8;
        const link = links.find(
          (f) =>
            near(f.geometry.coordinates[0], start) &&
            near(f.geometry.coordinates.at(-1)!, end),
        );
        coordinates.push(link?.geometry.coordinates ?? [start, end]);
      }
      return coordinates.length
        ? [
            {
              type: "Feature" as const,
              id: ride.id,
              properties: { rideId: ride.id },
              geometry: { type: "MultiLineString" as const, coordinates },
            },
          ]
        : [];
    }),
  };
}

export function rideBounds(
  rides: Ride[],
): [[number, number], [number, number]] | null {
  let west = Infinity,
    east = -Infinity,
    south = Infinity,
    north = -Infinity;
  for (const ride of rides)
    for (const segment of ride.segments)
      for (const point of segment) {
        west = Math.min(west, point.lon);
        east = Math.max(east, point.lon);
        south = Math.min(south, point.lat);
        north = Math.max(north, point.lat);
      }
  return Number.isFinite(west)
    ? [
        [west, south],
        [east, north],
      ]
    : null;
}

export function selectionFilter(
  id: string | null,
): ["==", ["get", string], string] {
  return ["==", ["get", "rideId"], id ?? ""];
}

export function routeLayers(
  selected: string | null,
  mode: "gps" | "route" | "heat" = "route",
): LayerSpecification[] {
  const raw = mode !== "heat";
  return [
    {
      id: ROUTES_CASING_LAYER,
      type: "line",
      source: RIDES_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROUTE_CASING_COLOR,
        "line-width": roadLineWidth(2),
        "line-opacity": raw && !selected ? 1 : 0,
        "line-opacity-transition": { duration: 0, delay: 0 },
      },
    },
    {
      id: ROUTES_LAYER,
      type: "line",
      source: RIDES_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROUTE_COLOR,
        "line-width": roadLineWidth(),
        "line-opacity": raw && !selected ? 1 : 0,
        "line-opacity-transition": { duration: 0, delay: 0 },
      },
    },
    {
      id: SELECTED_CASING_LAYER,
      type: "line",
      source: RIDES_SOURCE,
      filter: selectionFilter(selected),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROUTE_CASING_COLOR,
        "line-width": 8,
        "line-opacity": raw ? 1 : 0,
        "line-opacity-transition": { duration: 0, delay: 0 },
      },
    },
    {
      id: SELECTED_LAYER,
      type: "line",
      source: RIDES_SOURCE,
      filter: selectionFilter(selected),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": SELECTED_ROUTE_COLOR,
        "line-width": 6,
        "line-opacity": raw ? 1 : 0,
        "line-opacity-transition": { duration: 0, delay: 0 },
      },
    },
    {
      id: HIT_LAYER,
      type: "line",
      source: RIDES_SOURCE,
      layout: { visibility: raw ? "visible" : "none" },
      ...(selected ? { filter: selectionFilter(selected) } : {}),
      paint: { "line-color": ROUTE_COLOR, "line-width": 16, "line-opacity": 0 },
    },
  ];
}

// Local-only style allows saved routes to render even when the basemap cannot load.
export function localMapStyle(dark: boolean): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: {
          "background-color": dark ? DARK_MAP_BACKGROUND : LIGHT_MAP_BACKGROUND,
        },
      },
    ],
  };
}

export function withRides(
  style: StyleSpecification,
  rides: Ride[],
  selected: string | null,
  mode: "gps" | "route" | "heat" = "route",
): StyleSpecification {
  return {
    ...style,
    sources: {
      ...style.sources,
      [RIDES_SOURCE]: {
        type: "geojson",
        data: ridesGeoJSON(rides),
        tolerance: 0,
      },
    },
    layers: [...style.layers, ...routeLayers(selected, mode)],
  };
}
