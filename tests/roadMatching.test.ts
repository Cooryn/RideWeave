import { expect, it } from "vitest";
import type { Feature, LineString } from "geojson";
import type { Ride } from "../src/types";
import { matchRoads } from "../src/roadMatching";
const road = (
  coords = [
    [120, 30],
    [120.002, 30],
  ],
  kind = "minor",
): Feature<LineString> => ({
  type: "Feature",
  properties: { class: kind },
  geometry: { type: "LineString", coordinates: coords },
});
const ride = (
  id: string,
  coords = [
    [120, 30.00005],
    [120.002, 30.00005],
  ],
): Ride => ({
  id,
  name: id,
  date: null,
  distance: 1,
  duration: null,
  filename: "test",
  importedAt: "",
  segments: [
    coords.map(([lon, lat]) => ({ lon, lat, elevation: null, time: null })),
  ],
});
it("snaps GPS to actual roads, counts reverse rides, and deduplicates tiles and repeated passes", () => {
  const first = ride("a", [
    [120, 30.00005],
    [120.002, 30.00005],
    [120, 30.00005],
  ]);
  const second = ride("b", [
    [120.002, 30.00004],
    [120, 30.00004],
  ]);
  const before = JSON.stringify([first, second]);
  const result = matchRoads(
    [first, second],
    [
      road(),
      road(),
      road([
        [120.002, 30],
        [120, 30],
      ]),
    ],
  );
  expect(result.features.length).toBeGreaterThan(0);
  expect(result.features.every((f) => f.properties.count === 2)).toBe(true);
  expect(
    result.features.every((f) =>
      f.geometry.coordinates.every((p) => Math.abs(p[1] - 30) < 1e-9),
    ),
  ).toBe(true);
  expect(JSON.stringify([first, second])).toBe(before);
  expect(
    matchRoads([first], [road()]).features.every(
      (f) => f.properties.count === 1,
    ),
  ).toBe(true);
});
it("only heats the shared portion of roads", () => {
  const data = matchRoads(
    [
      ride("a"),
      ride("b", [
        [120.001, 30.00005],
        [120.002, 30.00005],
      ]),
    ],
    [road()],
  );
  expect(data.features.some((f) => f.properties.count === 1)).toBe(true);
  expect(data.features.some((f) => f.properties.count === 2)).toBe(true);
  expect(
    data.features
      .filter((f) => f.properties.count === 2)
      .every((f) => f.geometry.coordinates[0][0] >= 120.001 - 1e-9),
  ).toBe(true);
});
it("does not bridge segments, jumps, distant tracks, railways, or perpendicular crossings", () => {
  const split = ride("a");
  split.segments = split.segments[0].map((p) => [p]);
  for (const r of [
    split,
    ride("jump", [
      [120, 30],
      [120.01, 30],
    ]),
    ride("far", [
      [120, 30.001],
      [120.002, 30.001],
    ]),
    ride("cross", [
      [120.001, 29.999],
      [120.001, 30.001],
    ]),
  ]) {
    expect(matchRoads([r], [road()]).features).toEqual([]);
  }
  expect(matchRoads([ride("a")], [road(undefined, "rail")]).features).toEqual(
    [],
  );
  expect(matchRoads([], [road()]).features).toEqual([]);
  expect(matchRoads([ride("a")], []).features).toEqual([]);
});
it("leaves ambiguous parallel roads unmatched", () => {
  expect(
    matchRoads(
      [ride("a")],
      [
        road(),
        road([
          [120, 30.0001],
          [120.002, 30.0001],
        ]),
      ],
    ).features,
  ).toEqual([]);
});

it("continues through bends and junctions without gaps or diagonal shortcuts", () => {
  const coords = [
    [120, 30],
    [120.001, 30],
    [120.001, 30.001],
    [120.002, 30.001],
  ];
  const result = matchRoads([ride("a", coords)], [road(coords)]);
  expect(result.features).toHaveLength(1);
  expect(result.features[0].geometry.coordinates[0]).toEqual(coords[0]);
  expect(result.features[0].geometry.coordinates.at(-1)).toEqual(coords.at(-1));
  expect(result.features[0].geometry.coordinates).toContainEqual(coords[1]);
  expect(result.features[0].geometry.coordinates).toContainEqual(coords[2]);
});

it("joins a T junction and normalizes overlapping tile clips without double counting", () => {
  const roads = [
    road(),
    road([
      [120.0005, 30],
      [120.002, 30],
    ]),
    road([
      [120.001, 30],
      [120.001, 30.001],
    ]),
  ];
  const result = matchRoads(
    [
      ride("a", [
        [120, 30],
        [120.001, 30],
        [120.001, 30.001],
      ]),
    ],
    roads,
  );
  expect(result.features.length).toBeGreaterThan(0);
  expect(result.features.every((f) => f.properties.count === 1)).toBe(true);
  const lines = result.features.flatMap((f) => f.geometry.coordinates);
  expect(lines).toContainEqual([120.001, 30]);
  expect(lines).toContainEqual([120.001, 30.001]);
  expect(lines.every((p) => p[0] <= 120.00100001)).toBe(true);
});

it("does not connect missing roads or bridge crossings", () => {
  const result = matchRoads(
    [ride("a")],
    [
      road([
        [120, 30],
        [120.0008, 30],
      ]),
      road([
        [120.0012, 30],
        [120.002, 30],
      ]),
    ],
  );
  for (const f of result.features) {
    const xs = f.geometry.coordinates.map((p) => p[0]);
    expect(
      Math.max(...xs) <= 120.00080001 || Math.min(...xs) >= 120.00119999,
    ).toBe(true);
  }
  const bridge = road([
    [120.001, 29.999],
    [120.001, 30.001],
  ]);
  bridge.properties = { class: "minor", brunnel: "bridge", layer: 1 };
  const crossing = matchRoads(
    [
      ride("a", [
        [120, 30],
        [120.002, 30],
      ]),
    ],
    [road(), bridge],
  );
  expect(
    crossing.features.every((f) =>
      f.geometry.coordinates.every((p) => Math.abs(p[1] - 30) < 1e-9),
    ),
  ).toBe(true);
});

it("uses later observations to resolve an initially ambiguous parallel road without losing its prefix", () => {
  const trace = ride("a", [
    [120, 30.00005],
    [120.0008, 30.00005],
    [120.0016, 30.00005],
    [120.0024, 30],
    [120.0032, 30],
    [120.004, 30],
  ]);
  const result = matchRoads(
    [trace],
    [
      road([
        [120, 30],
        [120.004, 30],
      ]),
      road([
        [120, 30.0001],
        [120.002, 30.0001],
      ]),
    ],
  );
  expect(result.features).toHaveLength(1);
  expect(result.features[0].geometry.coordinates[0]).toEqual([120, 30]);
  expect(result.features[0].geometry.coordinates.at(-1)).toEqual([120.004, 30]);
  expect(
    result.features[0].geometry.coordinates.every((p) => p[1] === 30),
  ).toBe(true);
});

it("tolerates noisy short-step headings without cutting a continuous road into fragments", () => {
  const coords = Array.from({ length: 80 }, (_, i) => [
    120 + i * 0.00003,
    30 + (i % 2 ? 0.00007 : -0.00007),
  ]);
  const result = matchRoads(
    [ride("a", coords)],
    [
      road([
        [120, 30],
        [120.003, 30],
      ]),
    ],
  );
  expect(result.features).toHaveLength(1);
  const line = result.features[0].geometry.coordinates;
  expect(line.at(-1)![0] - line[0][0]).toBeGreaterThan(0.0021);
  expect(line.every((p) => p[1] === 30)).toBe(true);
});

it("keeps the confident prefix when the destination fork remains ambiguous", () => {
  const result = matchRoads(
    [
      ride("a", [
        [120, 30],
        [120.0008, 30],
        [120.001, 30],
        [120.0015, 30],
      ]),
    ],
    [
      road([
        [120, 30],
        [120.001, 30],
      ]),
      road([
        [120.001, 30],
        [120.002, 30.0001],
      ]),
      road([
        [120.001, 30],
        [120.002, 29.9999],
      ]),
    ],
  );
  expect(result.features.length).toBeGreaterThan(0);
  expect(result.features[0].geometry.coordinates[0]).toEqual([120, 30]);
  expect(
    result.features
      .flatMap((f) => f.geometry.coordinates)
      .every((p) => p[0] <= 120.00100001),
  ).toBe(true);
});
