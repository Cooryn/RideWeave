import type { FeatureCollection, MultiLineString } from "geojson";
import type { StyleSpecification, LayerSpecification } from "maplibre-gl";
import type { Ride } from "./types";

export const RIDES_SOURCE = "rideweave-rides";
export const ROUTES_LAYER = "rideweave-routes";
export const SELECTED_LAYER = "rideweave-selected";
export const HIT_LAYER = "rideweave-hit";
export const MAP_STYLES = {
  light: "https://tiles.openfreemap.org/styles/liberty",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

export function ridesGeoJSON(
  rides: Ride[],
): FeatureCollection<MultiLineString, { rideId: string }> {
  return {
    type: "FeatureCollection",
    features: rides.flatMap((ride) => {
      const coordinates = ride.segments
        .filter((segment) => segment.length >= 2)
        .map((segment) => segment.map((point) => [point.lon, point.lat]));
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

export function routeLayers(selected: string | null): LayerSpecification[] {
  return [
    {
      id: ROUTES_LAYER,
      type: "line",
      source: RIDES_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#169b72", "line-width": 3, "line-opacity": 0.8 },
    },
    {
      id: SELECTED_LAYER,
      type: "line",
      source: RIDES_SOURCE,
      filter: selectionFilter(selected),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#66e8a8", "line-width": 6, "line-opacity": 1 },
    },
    {
      id: HIT_LAYER,
      type: "line",
      source: RIDES_SOURCE,
      paint: { "line-color": "#169b72", "line-width": 16, "line-opacity": 0 },
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
        paint: { "background-color": dark ? "#18201f" : "#edf2ef" },
      },
    ],
  };
}

export function withRides(
  style: StyleSpecification,
  rides: Ride[],
  selected: string | null,
): StyleSpecification {
  return {
    ...style,
    sources: {
      ...style.sources,
      [RIDES_SOURCE]: { type: "geojson", data: ridesGeoJSON(rides) },
    },
    layers: [...style.layers, ...routeLayers(selected)],
  };
}
