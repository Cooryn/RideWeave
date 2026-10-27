import type { FeatureCollection, LineString } from "geojson";
import type {
  LineLayerSpecification,
  GeoJSONSourceSpecification,
} from "maplibre-gl";
import type { RoadMatches, RoadProperties } from "./roadMatching";

export const ROAD_SOURCE = "rideweave-road-matches";
export const ROAD_LAYER = "rideweave-road-colors";
export type RoadHeat = FeatureCollection<
  LineString,
  RoadProperties & { strength: number }
>;
export function roadHeatSource(data: RoadHeat): GeoJSONSourceSpecification {
  // GeoJSON-VT drops short line features when tolerance > 0. Our gradient
  // pieces are intentionally short; retain them at every source zoom level.
  return { type: "geojson", data, tolerance: 0 };
}
const key = (p: number[]) =>
  p
    .slice(0, 2)
    .map((n) => n.toFixed(6))
    .join(",");
const meters = (a: number[], b: number[]) =>
  Math.hypot(
    (b[0] - a[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180),
    b[1] - a[1],
  ) * 111195;

/** Smooth only along already matched geometry, never spread heat into surrounding space. */
export function roadHeat(matches: RoadMatches): RoadHeat {
  const nodes = new Map<string, number[]>();
  for (const f of matches.features)
    for (const p of [
      f.geometry.coordinates[0],
      f.geometry.coordinates.at(-1)!,
    ]) {
      const k = key(p);
      if (!nodes.has(k)) nodes.set(k, []);
      nodes.get(k)!.push(f.properties.count);
    }
  const output: RoadHeat = { type: "FeatureCollection", features: [] };
  for (const f of matches.features) {
    const coords = f.geometry.coordinates,
      lengths = [0];
    for (let i = 1; i < coords.length; i++)
      lengths.push(lengths[i - 1] + meters(coords[i - 1], coords[i]));
    const total = lengths.at(-1)!;
    if (!total) continue;
    const count = f.properties.count;
    const mean = (p: number[]) => {
      const values = nodes.get(key(p))!;
      return values.reduce((a, b) => a + b, 0) / values.length;
    };
    const start = mean(coords[0]),
      end = mean(coords.at(-1)!),
      blend = Math.min(10, total / 2);
    if (start === count && end === count) {
      output.features.push({
        ...f,
        properties: { ...f.properties, strength: count },
      });
      continue;
    }
    const stops = new Set([0, total, ...lengths]);
    // 32 short steps per transition give a sub-pixel color progression at normal street zoom.
    if (start !== count)
      for (let i = 1; i <= 32; i++) stops.add((blend * i) / 32);
    if (end !== count)
      for (let i = 0; i < 32; i++) stops.add(total - blend + (blend * i) / 32);
    const sorted = [...stops].sort((a, b) => a - b);
    let edge = 1;
    const at = (d: number) => {
      while (edge < lengths.length - 1 && lengths[edge] < d) edge++;
      const t =
        (d - lengths[edge - 1]) / (lengths[edge] - lengths[edge - 1] || 1);
      return coords[edge - 1].map(
        (n, axis) => n + (coords[edge][axis] - n) * t,
      );
    };
    let from = at(0);
    for (let i = 1; i < sorted.length; i++) {
      const to = at(sorted[i]),
        d = (sorted[i - 1] + sorted[i]) / 2;
      const strength =
        d < blend
          ? start + ((count - start) * d) / blend
          : d > total - blend
            ? count + ((end - count) * (d - total + blend)) / blend
            : count;
      output.features.push({
        type: "Feature",
        properties: { ...f.properties, strength },
        geometry: { type: "LineString", coordinates: [from, to] },
      });
      from = to;
    }
  }
  return output;
}

export function roadHeatLayer(): LineLayerSpecification {
  return {
    id: ROAD_LAYER,
    type: "line",
    source: ROAD_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        5,
        1.5,
        12,
        3,
        16,
        4,
        20,
        5,
      ],
      "line-blur": 0,
      "line-opacity": 1,
      "line-color": [
        "interpolate",
        ["linear"],
        ["get", "strength"],
        1,
        "#2864e6",
        2,
        "#20c9dc",
        3,
        "#47d58a",
        5,
        "#f5d64a",
        8,
        "#fa8738",
        10,
        "#e94055",
      ],
    },
  };
}
