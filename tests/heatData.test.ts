import { expect, it } from "vitest";
import { roadHeat, roadHeatLayer, roadHeatSource } from "../src/heatData";
import { GeoJSONVT } from "@maplibre/geojson-vt";
import type { RoadMatches } from "../src/roadMatching";
const data: RoadMatches = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { count: 1, rideIds: ["a"] },
      geometry: {
        type: "LineString",
        coordinates: [
          [120, 30],
          [120.001, 30],
        ],
      },
    },
    {
      type: "Feature",
      properties: { count: 3, rideIds: ["a", "b", "c"] },
      geometry: {
        type: "LineString",
        coordinates: [
          [120.001, 30],
          [120.002, 30],
        ],
      },
    },
  ],
};
it("gradually transitions overlap colors only along the matched road without changing counts", () => {
  const before = JSON.stringify(data),
    result = roadHeat(data);
  expect(result.features.length).toBeGreaterThan(10);
  expect(
    result.features.every((f) =>
      f.geometry.coordinates.every(
        (p) => p[1] === 30 && p[0] >= 120 && p[0] <= 120.002,
      ),
    ),
  ).toBe(true);
  expect(
    result.features.some(
      (f) => f.properties.strength > 1 && f.properties.strength < 2,
    ),
  ).toBe(true);
  expect(
    result.features.some(
      (f) => f.properties.strength > 2 && f.properties.strength < 3,
    ),
  ).toBe(true);
  expect(
    result.features.every((f) => [1, 3].includes(f.properties.count)),
  ).toBe(true);
  for (let i = 1; i < result.features.length; i++)
    expect(result.features[i].geometry.coordinates[0]).toEqual(
      result.features[i - 1].geometry.coordinates.at(-1),
    );
  expect(JSON.stringify(data)).toBe(before);
});

it("retains gradient pieces through real GeoJSON tile generation when zooming out", () => {
  const heat = roadHeat(data),
    source = roadHeatSource(heat);
  const fixed = new GeoJSONVT(heat, {
    tolerance: source.tolerance,
    extent: 8192,
    maxZoom: 18,
  });
  // Match MapLibre's old default: 0.375 screen pixels * 8192/512 tile units.
  const old = new GeoJSONVT(heat, { tolerance: 6, extent: 8192, maxZoom: 18 });
  for (const z of [6, 8, 10, 12, 14, 16]) {
    const n = 2 ** z,
      x = Math.floor(((120 + 180) / 360) * n);
    const y = Math.floor(
      ((1 - Math.asinh(Math.tan((30 * Math.PI) / 180)) / Math.PI) / 2) * n,
    );
    const tile = fixed.getTile(z, x, y)!;
    expect(tile.features.length).toBe(heat.features.length);
    if (z < 14)
      expect(old.getTile(z, x, y)!.features.length).toBeLessThan(
        tile.features.length,
      );
    for (let i = 1; i < tile.features.length; i++) {
      expect(tile.features[i].geometry[0][0]).toEqual(
        tile.features[i - 1].geometry[0].at(-1),
      );
    }
  }
});
it("preserves road bends and renders no diffuse heatmap", () => {
  const bent: RoadMatches = {
    type: "FeatureCollection",
    features: [
      {
        ...data.features[0],
        geometry: {
          type: "LineString",
          coordinates: [
            [120, 30],
            [120.001, 30],
            [120.001, 30.001],
          ],
        },
      },
    ],
  };
  expect(roadHeat(bent).features[0].geometry).toEqual(
    bent.features[0].geometry,
  );
  expect(
    roadHeat({ type: "FeatureCollection", features: [] }).features,
  ).toEqual([]);
  const layer = roadHeatLayer();
  expect(layer.type).toBe("line");
  expect(layer.paint?.["line-blur"]).toBe(0);
  expect(layer.paint?.["line-color"]).toContain("interpolate");
});
