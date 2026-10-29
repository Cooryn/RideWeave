import { expect, it } from "vitest";
import type { Feature, Geometry, LineString } from "geojson";
import { singleRoadNetwork } from "../src/roadNetwork";
import { matchRoads } from "../src/roadMatching";
import type { Ride } from "../src/types";
import publicJunction from "./fixtures/divided-junction.json";

const ll = ([x, y]: number[]) => [
  120 + x / (111195 * Math.cos(Math.PI / 6)),
  30 + y / 111195,
];
const road = (
  points: number[][],
  properties: Record<string, unknown> = {},
): Feature<LineString> => ({
  type: "Feature",
  properties: { class: "primary", oneway: 1, ...properties },
  geometry: { type: "LineString", coordinates: points.map(ll) },
});
const forward = road([
  [0, 0],
  [80, 0],
  [160, 0],
]);
const reverse = road([
  [160, 16],
  [100, 16],
  [0, 16],
]);
const lines = (roads: Feature<Geometry>[]) =>
  roads.filter(
    (r): r is Feature<LineString> => r.geometry.type === "LineString",
  );
const points = (roads: Feature<Geometry>[]) =>
  lines(roads).flatMap((r) => r.geometry.coordinates);
function connected(roads: Feature<Geometry>[], respectGrade = false) {
  const roots = new Map<string, string>();
  const root = (s: string): string => {
    const p = roots.get(s);
    if (!p) {
      roots.set(s, s);
      return s;
    }
    return p === s ? s : root(p);
  };
  for (const line of lines(roads)) {
    const keys = line.geometry.coordinates.map(
      (p) =>
        p.map((v) => v.toFixed(6)).join(",") +
        (respectGrade
          ? `|${line.properties?.layer ?? 0}:${line.properties?.brunnel ?? ""}`
          : ""),
    );
    for (let i = 1; i < keys.length; i++)
      roots.set(root(keys[i]), root(keys[i - 1]));
  }
  return new Set([...roots.keys()].map(root)).size;
}
function cycleRank(roads: Feature<Geometry>[]) {
  const nodes = new Set<string>(),
    edges = new Set<string>();
  for (const f of lines(roads)) {
    const keys = f.geometry.coordinates.map((p) =>
      p.map((v) => v.toFixed(6)).join(","),
    );
    for (let i = 1; i < keys.length; i++) {
      if (keys[i] === keys[i - 1]) continue;
      nodes.add(keys[i]);
      nodes.add(keys[i - 1]);
      edges.add([keys[i], keys[i - 1]].sort().join(";"));
    }
  }
  return edges.size - nodes.size + connected(roads);
}
const ride = (id: string, y: number, reverse = false): Ride => {
  const coords = Array.from({ length: 17 }, (_, i) => ll([i * 10, y]));
  if (reverse) coords.reverse();
  return {
    id,
    name: id,
    date: null,
    distance: 1,
    duration: null,
    filename: "test",
    importedAt: "",
    segments: [
      coords.map(([lon, lat]) => ({ lon, lat, time: null, elevation: null })),
    ],
  };
};

it("merges opposite carriageways with different vertices into one connected centreline", () => {
  const before = JSON.stringify([forward, reverse]);
  const network = singleRoadNetwork([forward, reverse]);
  expect(connected(network)).toBe(1);
  expect(
    points(network).every((p) => Math.abs(p[1] - ll([0, 8])[1]) < 1e-7),
  ).toBe(true);
  expect(network.every((r) => r.properties?.oneway === 0)).toBe(true);
  expect(singleRoadNetwork([reverse, forward])).toEqual(network);
  expect(JSON.stringify([forward, reverse])).toBe(before);
  expect(singleRoadNetwork(network)).toEqual(network);
});

it("counts all forward and reverse passes on one shared centreline", () => {
  const network = singleRoadNetwork([forward, reverse]);
  const a = ride("a", 0),
    b = ride("b", 16, true);
  a.segments[0].push(...a.segments[0].slice().reverse());
  const heat = matchRoads([a, b], network);
  expect(heat.features.length).toBeGreaterThan(0);
  expect(heat.features.every((f) => f.properties.count === 3)).toBe(true);
  expect(connected(heat.features)).toBe(1);
  expect(
    matchRoads([a], network).features.every((f) => f.properties.count === 2),
  ).toBe(true);
});

it("moves incident side roads with the merged junction and retains unpaired ends", () => {
  const branch = road(
    [
      [80, -60],
      [80, 0],
    ],
    { class: "minor", oneway: 0 },
  );
  const network = singleRoadNetwork([forward, reverse, branch]);
  expect(connected(network)).toBe(1);
  const side = lines(network).find((r) => r.properties?.class === "minor")!;
  expect(side.geometry.coordinates[1][1]).toBeCloseTo(ll([80, 8])[1], 7);
  const partial = singleRoadNetwork([
    road([
      [0, 0],
      [160, 0],
    ]),
    road([
      [120, 16],
      [40, 16],
    ]),
  ]);
  expect(connected(partial)).toBe(1);
  expect(points(partial)).toContainEqual(ll([0, 0]));
  expect(
    points(partial).some((p) => Math.abs(p[0] - ll([160, 0])[0]) < 1e-7),
  ).toBe(true);
});

it("preserves separate streets, ramps, grade separation and non-road geometry", () => {
  const a = road([
    [0, 0],
    [160, 0],
  ]);
  for (const b of [
    road([
      [0, 16],
      [160, 16],
    ]),
    road([
      [160, 40],
      [0, 40],
    ]),
    road(
      [
        [160, 16],
        [0, 16],
      ],
      { ramp: 1 },
    ),
    road(
      [
        [160, 16],
        [0, 16],
      ],
      { layer: 1, brunnel: "bridge" },
    ),
    road(
      [
        [160, 16],
        [0, 16],
      ],
      { class: "service" },
    ),
    road(
      [
        [160, 16],
        [0, 16],
      ],
      { oneway: 0 },
    ),
    road([
      [80, -40],
      [80, 40],
    ]),
    road(
      [
        [160, 16],
        [0, 16],
      ],
      { junction: "roundabout" },
    ),
  ])
    expect(singleRoadNetwork([a, b])).toEqual([a, b]);
  const named = road(
    [
      [0, 0],
      [160, 0],
    ],
    { name: "A" },
  );
  const other = road(
    [
      [160, 16],
      [0, 16],
    ],
    { name: "B" },
  );
  expect(singleRoadNetwork([named, other])).toEqual([named, other]);
  const minor = [
    road(
      [
        [0, 0],
        [160, 0],
      ],
      { class: "minor" },
    ),
    road(
      [
        [160, 16],
        [0, 16],
      ],
      { class: "minor" },
    ),
  ];
  expect(singleRoadNetwork(minor)).toEqual(minor);
  const polygon: Feature<Geometry> = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [120, 30],
          [120, 30.1],
          [120.1, 30],
          [120, 30],
        ],
      ],
    },
  };
  expect(singleRoadNetwork([forward, reverse, polygon])).toContainEqual(
    polygon,
  );
});

it("supports reversed one-way tagging and curved roads without disconnecting bends", () => {
  const a = road([
    [0, 0],
    [80, 0],
    [80, 80],
  ]);
  const b = road([
    [64, 80],
    [64, 16],
    [0, 16],
  ]);
  const network = singleRoadNetwork([a, b]);
  expect(connected(network)).toBe(1);
  expect(network.some((r) => r.properties?.oneway === 0)).toBe(true);
  const reversed = road(
    [
      [0, 16],
      [160, 16],
    ],
    { oneway: -1 },
  );
  expect(
    singleRoadNetwork([forward, reversed]).every(
      (r) => r.properties?.oneway === 0,
    ),
  ).toBe(true);
});

it("keeps roundabouts, hairpins and equally plausible carriageway pairs separate", () => {
  const loop = road([
    [0, 0],
    [80, 0],
    [80, 16],
    [0, 16],
    [0, 0],
  ]);
  const hairpin = road([
    [0, 0],
    [80, 0],
    [80, 16],
    [0, 16],
  ]);
  expect(singleRoadNetwork([loop])).toEqual([loop]);
  expect(singleRoadNetwork([hairpin])).toEqual([hairpin]);
  const ambiguous = [
    forward,
    reverse,
    road([
      [0, 32],
      [80, 32],
      [160, 32],
    ]),
  ];
  expect(singleRoadNetwork(ambiguous)).toEqual(ambiguous);
});

it("retains real bridge entrances and repairs small tile junction offsets", () => {
  const elevated = [forward, reverse].map((f) => ({
    ...f,
    properties: { ...f.properties, layer: 1, brunnel: "bridge" },
  }));
  const approach = road(
    [
      [-60, 0],
      [0, 0],
    ],
    { ramp: 1 },
  );
  const bridge = singleRoadNetwork([...elevated, approach]);
  expect(connected(bridge)).toBe(1);
  expect(
    lines(bridge)
      .find((f) => f.properties?.ramp)
      ?.geometry.coordinates.at(-1)![1],
  ).toBeCloseTo(ll([0, 8])[1], 7);
  const side = road(
    [
      [80, -60],
      [80, -0.8],
    ],
    { class: "minor", oneway: 0 },
  );
  const junction = singleRoadNetwork([forward, reverse, side]);
  expect(connected(junction)).toBe(1);
  expect(
    lines(junction)
      .find((f) => f.properties?.class === "minor")!
      .geometry.coordinates.at(-1)![1],
  ).toBeCloseTo(ll([80, 8])[1], 7);
});

it("collapses flared median cells into one junction without losing an attached street", () => {
  const a = road([
    [0, -8],
    [80, -8],
    [100, -14],
    [120, -8],
    [200, -8],
  ]);
  const b = road([
    [200, 8],
    [120, 8],
    [100, 14],
    [80, 8],
    [0, 8],
  ]);
  const side = road(
    [
      [100, -14],
      [100, -60],
    ],
    { class: "minor", oneway: 0 },
  );
  const network = singleRoadNetwork([a, b, side]);
  expect(connected(network)).toBe(1);
  expect(cycleRank(network)).toBe(0);
  expect(
    points(network).some((p) => Math.abs(p[1] - ll([100, -60])[1]) < 1e-7),
  ).toBe(true);
  const main = lines(network).filter((f) => f.properties?.class === "primary");
  expect(points(main).every((p) => Math.abs(p[1] - 30) < 1e-7)).toBe(true);
});

it("keeps the four arms of a divided-road intersection on a single connected junction", () => {
  const roads = [
    road([
      [-100, -8],
      [-8, -8],
      [8, -8],
      [100, -8],
    ]),
    road([
      [100, 8],
      [8, 8],
      [-8, 8],
      [-100, 8],
    ]),
    road(
      [
        [-8, 100],
        [-8, 8],
        [-8, -8],
        [-8, -100],
      ],
      { class: "secondary" },
    ),
    road(
      [
        [8, -100],
        [8, -8],
        [8, 8],
        [8, 100],
      ],
      { class: "secondary" },
    ),
  ];
  const network = singleRoadNetwork(roads);
  expect(connected(network)).toBe(1);
  expect(cycleRank(network)).toBe(0);
  for (const end of [
    [-100, 0],
    [100, 0],
    [0, -100],
    [0, 100],
  ])
    expect(
      points(network).some(
        (p) =>
          Math.hypot(
            (p[0] - ll(end)[0]) * 96300,
            (p[1] - ll(end)[1]) * 111195,
          ) < 0.1,
      ),
    ).toBe(true);
  const heat = matchRoads(
    [
      {
        ...ride("cross", 0),
        segments: [
          [
            [-90, -8],
            [0, -8],
            [8, -8],
            [8, 90],
          ]
            .map(ll)
            .map(([lon, lat]) => ({ lon, lat, time: null, elevation: null })),
        ],
      },
    ],
    network,
  );
  expect(connected(heat.features)).toBe(1);
});

it("removes the reproduced public-tile junction loops while retaining all connected approaches", () => {
  const roads = publicJunction.features.map((f) =>
    road(f.coordinates, f.properties),
  );
  for (const input of [roads, roads.slice().reverse()]) {
    const network = singleRoadNetwork(input);
    expect(connected(network)).toBe(1);
    expect(cycleRank(network)).toBe(0);
    const trace = {
      ...ride("public-junction", 0),
      segments: [
        [
          [5, -60],
          [0, -30],
          [-3, 0],
          [-7, 30],
          [-10, 60],
        ]
          .map(ll)
          .map(([lon, lat]) => ({ lon, lat, time: null, elevation: null })),
      ],
    };
    const heat = matchRoads(
      [
        trace,
        {
          ...trace,
          id: "reverse",
          segments: [trace.segments[0].slice().reverse()],
        },
      ],
      network,
    );
    expect(heat.features.length).toBeGreaterThan(0);
    expect(connected(heat.features)).toBe(1);
    expect(heat.features.every((f) => f.properties.count === 2)).toBe(true);
  }
});

it("preserves an actual closed roundabout beside a confirmed carriageway merge", () => {
  const roundabout = road(
    [
      [100, 40],
      [112, 52],
      [100, 64],
      [88, 52],
      [100, 40],
    ],
    { junction: "roundabout" },
  );
  const network = singleRoadNetwork([forward, reverse, roundabout]);
  expect(cycleRank(network)).toBe(1);
  for (const p of roundabout.geometry.coordinates)
    expect(
      points(network).some(
        (q) => Math.hypot((p[0] - q[0]) * 96300, (p[1] - q[1]) * 111195) < 0.02,
      ),
    ).toBe(true);
});

it("does not collapse a large city block or a grade-separated crossing near merged roads", () => {
  const block = road([
    [0, 60],
    [80, 60],
    [80, 140],
    [0, 140],
    [0, 60],
  ]);
  const overpass = road(
    [
      [80, -60],
      [80, 60],
    ],
    { oneway: 0, layer: 1, brunnel: "bridge" },
  );
  const network = singleRoadNetwork([forward, reverse, block, overpass]);
  expect(cycleRank(network)).toBe(1);
  expect(connected(network, true)).toBe(3);
  const bridge = lines(network).find(
    (f) => f.properties?.brunnel === "bridge",
  )!;
  expect(bridge.geometry.coordinates[0][0]).toBeCloseTo(
    overpass.geometry.coordinates[0][0],
    7,
  );
  expect(bridge.geometry.coordinates[0][1]).toBeCloseTo(
    overpass.geometry.coordinates[0][1],
    7,
  );
  expect(bridge.geometry.coordinates.at(-1)![1]).toBeCloseTo(
    overpass.geometry.coordinates.at(-1)![1],
    7,
  );
});

it("centres opposite bridge carriageways when only one side omits its layer, without changing source metadata", () => {
  const roads = [
    road([
      [-180, -8],
      [-40, -8],
    ]),
    road(
      [
        [-40, -8],
        [30, -8],
      ],
      { brunnel: "bridge" },
    ),
    road([
      [30, -8],
      [180, -8],
    ]),
    road([
      [180, 8],
      [40, 8],
    ]),
    road(
      [
        [40, 8],
        [-30, 8],
      ],
      { brunnel: "bridge", layer: 1 },
    ),
    road([
      [-30, 8],
      [-180, 8],
    ]),
  ];
  const before = JSON.stringify(roads),
    network = singleRoadNetwork(roads);
  expect(connected(network)).toBe(1);
  expect(cycleRank(network)).toBe(0);
  expect(
    points(network).every((p) => Math.abs((p[1] - 30) * 111195) < 0.1),
  ).toBe(true);
  expect(JSON.stringify(roads)).toBe(before);
});

it("preserves explicit bridge levels and refuses to infer a missing layer from conflicting bridge candidates", () => {
  const a = road(
    [
      [0, 0],
      [160, 0],
    ],
    { brunnel: "bridge", layer: 0 },
  );
  const b = road(
    [
      [160, 16],
      [0, 16],
    ],
    { brunnel: "bridge", layer: 1 },
  );
  expect(singleRoadNetwork([a, b])).toEqual([a, b]);
  const unknown = road(
    [
      [0, 0],
      [160, 0],
    ],
    { brunnel: "bridge" },
  );
  const c = road(
    [
      [160, 28],
      [0, 28],
    ],
    { brunnel: "bridge", layer: 2 },
  );
  expect(singleRoadNetwork([unknown, b, c])).toEqual([unknown, b, c]);
});

it("removes buffered copies of a paired OSM way, including differently clipped overlaps", () => {
  const a = { ...forward, id: 1 },
    b = { ...reverse, id: 2 };
  const copied = {
    ...road([
      [40, 0],
      [100, 0],
    ]),
    id: 1,
  };
  const input = [a, b, { ...a }, copied];
  const network = singleRoadNetwork(input);
  expect(connected(network)).toBe(1);
  expect(cycleRank(network)).toBe(0);
  expect(
    points(network).every(
      (p) => Math.abs((p[1] - ll([0, 8])[1]) * 111195) < 0.1,
    ),
  ).toBe(true);
  expect(singleRoadNetwork(input.slice().reverse())).toEqual(network);
});
