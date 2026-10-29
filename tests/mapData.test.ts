import { expect, it } from "vitest";
import {
  ridesGeoJSON,
  rideBounds,
  localMapStyle,
  withRides,
  RIDES_SOURCE,
} from "../src/mapData";
import type { Ride } from "../src/types";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
const point = (lat: number, lon: number) => ({
  lat,
  lon,
  time: null,
  elevation: null,
});
const ride: Ride = {
  id: "one",
  name: "Name",
  date: null,
  distance: 1,
  duration: null,
  filename: "one.gpx",
  importedAt: "2026-10-01",
  segments: [
    [point(30, 120), point(31, 121)],
    [point(32, 122)],
    [point(33, 123), point(34, 124)],
  ],
};
it("keeps segment gaps and longitude/latitude order without mutating stored records", () => {
  const before = JSON.stringify(ride);
  expect(ridesGeoJSON([ride]).features[0].geometry.coordinates).toEqual([
    [
      [120, 30],
      [121, 31],
    ],
    [
      [123, 33],
      [124, 34],
    ],
  ]);
  expect(JSON.stringify(ride)).toBe(before);
  expect(rideBounds([ride])).toEqual([
    [120, 30],
    [124, 34],
  ]);
  expect(rideBounds([])).toBeNull();
});
it("builds an offline style with no external resources and handles empty routes", () => {
  const style = withRides(localMapStyle(true), [], null);
  expect(Object.keys(style.sources)).toEqual([RIDES_SOURCE]);
  expect(ridesGeoJSON([]).features).toEqual([]);
  expect(style.glyphs).toBeUndefined();
});

it("preserves every recorded GPS coordinate and closes pauses with a routed link or endpoint fallback", () => {
  const timed = (x: number, t: number) => ({
    lon: 120 + x / 111195,
    lat: 30.00005,
    elevation: null,
    time: new Date(Date.UTC(2026, 0, 1) + t * 1000).toISOString(),
  });
  const before = [timed(0, 0), timed(40, 10), timed(80, 20)],
    after = [timed(160, 120), timed(200, 130), timed(240, 140)];
  const trace = { ...ride, segments: [[...before, ...after]] },
    saved = JSON.stringify(trace);
  const a = [before.at(-1)!.lon, before.at(-1)!.lat],
    b = [after[0].lon, after[0].lat];
  const recorded = [
    before.map((p) => [p.lon, p.lat]),
    after.map((p) => [p.lon, p.lat]),
  ];
  expect(ridesGeoJSON([trace]).features[0].geometry.coordinates).toEqual([
    ...recorded,
    [a, b],
  ]);
  const path = [a, [a[0], 30], [b[0], 30], b];
  const linked = ridesGeoJSON([trace], {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { rideId: trace.id },
        geometry: { type: "LineString", coordinates: path },
      },
    ],
  });
  expect(linked.features[0].geometry.coordinates).toEqual([...recorded, path]);
  expect(JSON.stringify(trace)).toBe(saved);
  for (const mode of ["route", "heat"] as const) {
    const style = withRides(localMapStyle(true), [trace], null, mode);
    expect(validateStyleMin(style)).toEqual([]);
    expect(style.sources[RIDES_SOURCE]).toMatchObject({ tolerance: 0 });
  }
});
