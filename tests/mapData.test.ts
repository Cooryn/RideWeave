import { expect, it } from "vitest";
import {
  ridesGeoJSON,
  rideBounds,
  localMapStyle,
  withRides,
  RIDES_SOURCE,
} from "../src/mapData";
import type { Ride } from "../src/types";
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
