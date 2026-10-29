import { expect, it } from "vitest";
import type { Feature, LineString } from "geojson";
import type { Ride } from "../src/types";
import { matchRoads, type RoadMatches } from "../src/roadMatching";

const ll = ([x, y]: number[]) => [
  120 + x / (111195 * Math.cos(Math.PI / 6)),
  30 + y / 111195,
];
const road = (coords: number[][], properties = {}): Feature<LineString> => ({
  type: "Feature",
  properties: { class: "minor", ...properties },
  geometry: { type: "LineString", coordinates: coords.map(ll) },
});
const ride = (parts: number[][][], id = "a"): Ride => ({
  id,
  name: id,
  date: null,
  importedAt: "",
  filename: "test",
  distance: 1,
  duration: 140,
  segments: parts.map((line, segment) =>
    line.map(([x, y], i) => {
      const [lon, lat] = ll([x, y]);
      return {
        lon,
        lat,
        elevation: null,
        time: new Date(
          Date.UTC(2026, 9, 29) + (segment * 120 + i * 10) * 1000,
        ).toISOString(),
      };
    }),
  ),
});
const paused = () =>
  ride([
    [
      [0, 0],
      [40, 0],
      [80, 0],
    ],
    [
      [160, 0],
      [200, 0],
      [240, 0],
    ],
  ]);
const components = (data: RoadMatches) => {
  const parents = new Map<string, string>();
  const root = (s: string): string => {
    if (!parents.has(s)) parents.set(s, s);
    const p = parents.get(s)!;
    if (p === s) return s;
    const r = root(p);
    parents.set(s, r);
    return r;
  };
  for (const f of data.features)
    for (let i = 1; i < f.geometry.coordinates.length; i++) {
      const key = (p: number[]) => p.map((n) => n.toFixed(6)).join(",");
      parents.set(
        root(key(f.geometry.coordinates[i])),
        root(key(f.geometry.coordinates[i - 1])),
      );
    }
  return new Set([...parents.keys()].map(root)).size;
};
it("joins a recording pause along the same road as an explicit inferred link, without changing saved stats", () => {
  const trace = paused(),
    before = JSON.stringify(trace);
  const result = matchRoads(
    [trace],
    [
      road([
        [0, 0],
        [300, 0],
      ]),
    ],
  );
  expect(components(result)).toBe(1);
  const links = result.features.filter((f) => f.properties.inferred);
  expect(links.length).toBeGreaterThan(0);
  expect(
    links.every(
      (f) =>
        f.properties.count === 0 && f.properties.inferredRideIds?.includes("a"),
    ),
  ).toBe(true);
  expect(JSON.stringify(trace)).toBe(before);
  expect(result.pauseLinks?.features).toHaveLength(1);
  expect(result.pauseLinks?.features[0].geometry.coordinates[0]).toEqual([
    trace.segments[0].at(-1)!.lon,
    trace.segments[0].at(-1)!.lat,
  ]);
  expect(result.pauseLinks?.features[0].geometry.coordinates.at(-1)).toEqual([
    trace.segments[1][0].lon,
    trace.segments[1][0].lat,
  ]);
  const insideSegment = { ...trace, segments: [trace.segments.flat()] };
  expect(
    matchRoads(
      [insideSegment],
      [
        road([
          [0, 0],
          [300, 0],
        ]),
      ],
    ).features.some((f) => f.properties.inferred),
  ).toBe(true);
});
it("follows an actual corner during a pause instead of drawing a diagonal shortcut", () => {
  const trace = ride([
    [
      [0, 0],
      [30, 0],
      [60, 0],
    ],
    [
      [100, 80],
      [100, 100],
      [130, 100],
      [160, 100],
    ],
  ]);
  const result = matchRoads(
    [trace],
    [
      road([
        [0, 0],
        [100, 0],
        [100, 100],
        [200, 100],
      ]),
    ],
  );
  expect(components(result)).toBe(1);
  const links = result.features.filter((f) => f.properties.inferred);
  expect(links.length).toBeGreaterThan(0);
  expect(
    links
      .flatMap((f) => f.geometry.coordinates)
      .some(
        (p) =>
          Math.hypot((p[0] - ll([100, 0])[0]) * 96300, (p[1] - 30) * 111195) <
          0.2,
      ),
  ).toBe(true);
});
it("chooses the shortest road when multiple similar alternatives connect a pause", () => {
  const trace = ride([
    [
      [0, 0],
      [30, 0],
      [60, 0],
    ],
    [
      [220, 0],
      [250, 0],
      [280, 0],
    ],
  ]);
  const result = matchRoads(
    [trace],
    [
      road([
        [0, 0],
        [80, 0],
      ]),
      road([
        [80, 0],
        [140, 40],
        [200, 0],
      ]),
      road([
        [80, 0],
        [140, -60],
        [200, 0],
      ]),
      road([
        [200, 0],
        [300, 0],
      ]),
    ],
  );
  const inferred = result.features.filter((f) => f.properties.inferred);
  expect(inferred.length).toBeGreaterThan(0);
  expect(
    inferred.flatMap((f) => f.geometry.coordinates).every((p) => p[1] >= 30),
  ).toBe(true);
  expect(components(result)).toBe(1);
});
it("does not connect missing road geometry, grade separation or different ride records", () => {
  const trace = paused();
  for (const roads of [
    [
      road([
        [0, 0],
        [80, 0],
      ]),
      road([
        [160, 0],
        [300, 0],
      ]),
    ],
    [
      road([
        [0, 0],
        [100, 0],
      ]),
      road(
        [
          [60, 0],
          [300, 0],
        ],
        { layer: 1, brunnel: "bridge" },
      ),
    ],
  ]) {
    const result = matchRoads([trace], roads);
    expect(result.features.some((f) => f.properties.inferred)).toBe(false);
  }
  const separate = matchRoads(
    [
      { ...trace, segments: [trace.segments[0]] },
      { ...trace, id: "b", segments: [trace.segments[1]] },
    ],
    [
      road([
        [0, 0],
        [300, 0],
      ]),
    ],
  );
  expect(separate.features.some((f) => f.properties.inferred)).toBe(false);
  expect(components(separate)).toBe(2);
});
it("does not add inferred passage to the heat count when another ride actually recorded the road", () => {
  const b = ride([Array.from({ length: 7 }, (_, i) => [i * 40, 0])], "b");
  const result = matchRoads(
    [paused(), b],
    [
      road([
        [0, 0],
        [300, 0],
      ]),
    ],
  );
  const middle = result.features.filter((f) =>
    f.properties.inferredRideIds?.includes("a"),
  );
  expect(middle.length).toBeGreaterThan(0);
  expect(
    middle.every(
      (f) =>
        f.properties.count === 1 &&
        f.properties.observedRideIds?.join() === "b" &&
        f.properties.rideIds.length === 2 &&
        !f.properties.inferred,
    ),
  ).toBe(true);
  expect(
    result.pauseLinks?.features.some((f) => f.properties.rideId === "a"),
  ).toBe(true);
});

it("repairs a timed pause beyond 300 m but requires more context for gaps over 500 m", () => {
  const roads = [
    road([
      [0, 0],
      [900, 0],
    ]),
  ];
  const short = ride([
    [
      [0, 0],
      [40, 0],
      [80, 0],
    ],
    [
      [480, 0],
      [520, 0],
      [560, 0],
    ],
  ]);
  const repaired = matchRoads([short], roads);
  expect(repaired.features.some((f) => f.properties.inferred)).toBe(true);
  expect(components(repaired)).toBe(1);
  const long = ride([
    [
      [0, 0],
      [40, 0],
      [80, 0],
    ],
    [
      [680, 0],
      [720, 0],
      [760, 0],
    ],
  ]);
  const untouched = matchRoads([long], roads);
  expect(untouched.features.some((f) => f.properties.inferred)).toBe(false);
  expect(components(untouched)).toBe(2);
});

it("routes a supported kilometre-scale pause along a curved road, retaining the original record", () => {
  const trace = ride([
    Array.from({ length: 16 }, (_, i) => [i * 6, 0]),
    Array.from({ length: 16 }, (_, i) => [1770 + i * 3, 0]),
  ]);
  trace.segments.forEach((line, part) =>
    line.forEach((p, i) => {
      p.time = new Date(
        Date.UTC(2026, 0, 1) + (part ? 1285 + i : i) * 1000,
      ).toISOString();
    }),
  );
  const before = JSON.stringify(trace);
  const result = matchRoads(
    [trace],
    [
      road([
        [0, 0],
        [120, 0],
        [850, 250],
        [1700, 0],
        [1900, 0],
      ]),
    ],
  );
  expect(components(result)).toBe(1);
  const inferred = result.features.filter((f) => f.properties.inferred);
  expect(inferred.length).toBeGreaterThan(0);
  expect(inferred.every((f) => f.properties.count === 0)).toBe(true);
  expect(
    inferred.flatMap((f) => f.geometry.coordinates).some((p) => p[1] > 30.001),
  ).toBe(true);
  expect(JSON.stringify(trace)).toBe(before);
  const ambiguous = matchRoads(
    [trace],
    [
      road([
        [0, 0],
        [120, 0],
      ]),
      road([
        [120, 0],
        [850, 250],
        [1700, 0],
      ]),
      road([
        [120, 0],
        [850, -250],
        [1700, 0],
      ]),
      road([
        [1700, 0],
        [1900, 0],
      ]),
    ],
  );
  expect(ambiguous.features.some((f) => f.properties.inferred)).toBe(true);
  expect(components(ambiguous)).toBe(1);

  // Once a pause is detected, route speed does not reject its shortest road.
  const fast = {
    ...trace,
    segments: trace.segments.map((line, part) =>
      line.map((p, i) => ({
        ...p,
        time: new Date(
          Date.UTC(2026, 0, 1) + (part ? 195 + i : i) * 1000,
        ).toISOString(),
      })),
    ),
  };
  expect(
    matchRoads(
      [fast],
      [
        road([
          [0, 0],
          [120, 0],
          [850, 250],
          [1700, 0],
          [1900, 0],
        ]),
      ],
    ).features.some((f) => f.properties.inferred),
  ).toBe(true);
});

it("uses the shortest loaded road even when a detour exceeds the old corridor and path limits", () => {
  const trace = paused();
  const result = matchRoads(
    [trace],
    [
      road([
        [0, 0],
        [100, 0],
        [100, 700],
        [160, 700],
        [160, 0],
        [300, 0],
      ]),
    ],
  );
  const inferred = result.features.filter((f) => f.properties.inferred);
  expect(components(result)).toBe(1);
  const length = inferred.reduce(
    (total, f) =>
      total +
      f.geometry.coordinates.slice(1).reduce((n, p, i) => {
        const a = f.geometry.coordinates[i];
        return (
          n +
          Math.hypot(
            (p[0] - a[0]) * 111195 * Math.cos(Math.PI / 6),
            (p[1] - a[1]) * 111195,
          )
        );
      }, 0),
    0,
  );
  expect(length).toBeGreaterThan(1479);
  expect(length).toBeLessThan(1481);
});

it("snaps pause endpoints to the nearest road when stationary observations cannot establish headings", () => {
  const trace = ride([
    [
      [0, 0],
      [0, 0],
    ],
    [
      [80, 0],
      [80, 0],
    ],
  ]);
  const result = matchRoads(
    [trace],
    [
      road([
        [0, 0],
        [200, 0],
      ]),
    ],
  );
  expect(result.features.length).toBeGreaterThan(0);
  expect(
    result.features.every(
      (f) => f.properties.inferred && f.properties.count === 0,
    ),
  ).toBe(true);
  expect(components(result)).toBe(1);
});
