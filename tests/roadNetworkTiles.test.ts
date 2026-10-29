import { expect, it } from "vitest";
import { VectorTile } from "@mapbox/vector-tile";
import { fromVectorTileJs, GeoJSONWrapper } from "@maplibre/vt-pbf";
import Pbf from "pbf";
import { roadNetworkTile } from "../src/roadNetworkTiles";
import { matchRoads } from "../src/roadMatching";
import type { Ride } from "../src/types";

function fixture(shift = 0) {
  const layer = new GeoJSONWrapper(
    [
      {
        type: 2,
        tags: { class: "primary", oneway: 1 },
        geometry: [
          [
            [-100 + shift, 2000],
            [4200 + shift, 2000],
          ],
        ],
      },
      {
        type: 2,
        tags: { class: "primary", oneway: 1 },
        geometry: [
          [
            [4200 + shift, 2020],
            [-100 + shift, 2020],
          ],
        ],
      },
    ],
    { extent: 4096, version: 2 },
  );
  layer.name = "transportation";
  return fromVectorTileJs({ layers: { transportation: layer } }).slice()
    .buffer as ArrayBuffer;
}

it("derives a private GPX centreline without rewriting the original road tile", () => {
  const buffer = fixture(),
    before = new Uint8Array(buffer).slice();
  const roads = roadNetworkTile(buffer, 100, 8192, 14).roads;
  expect(roads).toHaveLength(1);
  expect(roads[0].properties?.oneway).toBe(0);
  expect(new Uint8Array(buffer)).toEqual(before);
  const original = new VectorTile(new Pbf(new Uint8Array(buffer))).layers
    .transportation;
  expect(original.length).toBe(2);
  expect(original.feature(0).loadGeometry()[0][0].y).toBe(2000);
  expect(original.feature(1).loadGeometry()[0][0].y).toBe(2020);
});

it("uses the same centreline on neighbouring buffered tiles", () => {
  expect(roadNetworkTile(fixture(), 100, 8192, 14).roads).toEqual(
    roadNetworkTile(fixture(-4096), 101, 8192, 14).roads,
  );
});

it("matches rides on both original carriageways onto the one shared middle line", () => {
  const buffer = fixture(),
    layer = new VectorTile(new Pbf(new Uint8Array(buffer))).layers
      .transportation;
  const first = layer.feature(0).toGeoJSON(100, 8192, 14),
    second = layer.feature(1).toGeoJSON(100, 8192, 14);
  if (
    first.geometry.type !== "LineString" ||
    second.geometry.type !== "LineString"
  )
    throw new Error("Invalid fixture");
  const lo = first.geometry.coordinates[0][0],
    hi = first.geometry.coordinates[1][0];
  const ride = (id: string, lat: number, reverse = false): Ride => {
    const segment = Array.from({ length: 21 }, (_, i) => ({
      lon: lo + (hi - lo) * (0.25 + i / 80),
      lat,
      time: null,
      elevation: null,
    }));
    if (reverse) segment.reverse();
    return {
      id,
      name: id,
      date: null,
      filename: "test",
      importedAt: "",
      distance: 1,
      duration: null,
      segments: [segment],
    };
  };
  const latA = first.geometry.coordinates[0][1],
    latB = second.geometry.coordinates[0][1];
  const a = ride("a", latA),
    b = ride("b", latB, true),
    before = JSON.stringify([a, b]);
  const matched = matchRoads(
    [a, b],
    roadNetworkTile(buffer, 100, 8192, 14).roads,
  );
  expect(matched.features).toHaveLength(1);
  expect(matched.features[0].properties.count).toBe(2);
  expect(
    matched.features[0].geometry.coordinates.every(
      (p) => Math.abs(p[1] - (latA + latB) / 2) < 1e-6,
    ),
  ).toBe(true);
  expect(JSON.stringify([a, b])).toBe(before);
});
