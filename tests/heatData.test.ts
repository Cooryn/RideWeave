import { expect, it } from "vitest";
import {
  roadHeat,
  roadHeatLayer,
  roadHeatSource,
  roadRouteCasingLayer,
  ROAD_SOURCE,
} from "../src/heatData";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
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

it("merges pause links into the same solid road layer and heat transitions while preserving actual counts", () => {
  const matched: RoadMatches = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { count: 3, rideIds: ["a", "b", "c"] },
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
        properties: {
          count: 0,
          rideIds: ["a"],
          inferred: true,
          observedRideIds: [],
          inferredRideIds: ["a"],
        },
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
  const heat = roadHeat(matched);
  expect(
    heat.features
      .filter((f) => !f.properties.inferred)
      .every(
        (f) =>
          f.properties.count === 3 &&
          f.properties.strength >= 2 &&
          f.properties.strength <= 3,
      ),
  ).toBe(true);
  const links = heat.features.filter((f) => f.properties.inferred);
  expect(links.length).toBeGreaterThan(0);
  expect(
    links.every(
      (f) =>
        f.properties.count === 0 &&
        f.properties.strength >= 1 &&
        f.properties.strength <= 2,
    ),
  ).toBe(true);
  expect(roadHeatLayer().paint?.["line-dasharray"]).toBeUndefined();
  expect(roadHeatLayer().filter).toBeUndefined();
});
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

it("builds valid road layers and retains short gradient segments at every zoom", () => {
  const casing = roadRouteCasingLayer(),
    heat = roadHeatLayer();
  expect(
    validateStyleMin({
      version: 8,
      sources: { [ROAD_SOURCE]: roadHeatSource(roadHeat(data)) },
      layers: [casing, heat],
    }),
  ).toEqual([]);
  expect(roadHeatSource(roadHeat(data)).tolerance).toBe(0);
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
