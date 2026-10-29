import { beforeEach, afterEach, expect, it, vi } from "vitest";
import Pbf from "pbf";
import { fromVectorTileJs, GeoJSONWrapper } from "@maplibre/vt-pbf";
import type { Ride } from "../src/types";
let api: typeof import("../src/roadTiles");
const ride = (
  coords = [
    [120, 30],
    [120.001, 30],
  ],
): Ride => ({
  id: "a",
  name: "",
  filename: "",
  importedAt: "",
  date: null,
  distance: 0,
  duration: null,
  segments: [
    coords.map(([lon, lat]) => ({ lon, lat, time: null, elevation: null })),
  ],
});
function tileBuffer() {
  const p = new Pbf();
  p.writeMessage(
    3,
    (_: unknown, layer: Pbf) => {
      layer.writeStringField(1, "transportation");
      layer.writeMessage(
        2,
        (_: unknown, feature: Pbf) => {
          feature.writePackedVarint(2, [0, 0]);
          feature.writeVarintField(3, 2);
          feature.writePackedVarint(4, [9, 0, 0, 10, 200, 0]);
        },
        null,
      );
      layer.writeStringField(3, "class");
      layer.writeMessage(
        4,
        (_: unknown, value: Pbf) => value.writeStringField(1, "minor"),
        null,
      );
      layer.writeVarintField(5, 4096);
      layer.writeVarintField(15, 2);
    },
    null,
  );
  return p.finish().slice().buffer;
}
const metadata = new TextEncoder().encode(
  JSON.stringify({
    tiles: ["https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf"],
  }),
).buffer;
beforeEach(async () => {
  vi.resetModules();
  api = await import("../src/roadTiles");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      arrayBuffer: async () =>
        url.endsWith("/planet") ? metadata : tileBuffer(),
    })),
  );
});
afterEach(() => vi.unstubAllGlobals());
it("requests only a bounded corridor and never fills GPX gaps", () => {
  const planned = api.roadTilePlan([ride()]);
  expect(planned.tiles.length).toBeGreaterThan(0);
  expect(planned.tiles.length).toBeLessThan(6);
  expect(
    api.roadTilePlan([
      ride([
        [120, 30],
        [121, 30],
      ]),
    ]).tiles,
  ).toEqual([]);
  const split = ride();
  split.segments = split.segments[0].map((p) => [p]);
  expect(api.roadTilePlan([split]).tiles).toEqual([]);
  const long = Array.from({ length: 400 }, (_, i) =>
    ride([
      [i * 0.05, 30],
      [i * 0.05 + 0.001, 30],
    ]),
  );
  expect(api.roadTilePlan(long).tiles).toHaveLength(256);
  expect(api.roadTilePlan(long).omitted).toBeGreaterThan(0);
});
it("decodes real protobuf road geometry, reuses it offline and sends only map tile URLs", async () => {
  const result = await api.loadRoadTiles(
    [ride()],
    new AbortController().signal,
  );
  expect(result.failed).toBe(0);
  expect(result.roads.length).toBeGreaterThan(0);
  expect(result.roads[0].geometry.type).toBe("LineString");
  expect(result.roads[0].properties?.class).toBe("minor");
  const calls = vi.mocked(fetch).mock.calls;
  expect(
    calls.every(
      ([url, options]) =>
        String(url).startsWith("https://tiles.openfreemap.org/") &&
        !options?.body,
    ),
  ).toBe(true);
  vi.mocked(fetch).mockRejectedValue(new Error("offline"));
  const cached = await api.loadRoadTiles(
    [ride()],
    new AbortController().signal,
  );
  expect(cached.roads).toEqual(result.roads);
  expect(cached.failed).toBe(0);
});
it("reports missing tiles and supports retry without caching failures", async () => {
  const normal = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).endsWith(".pbf")) throw new Error("offline");
    return normal(url, init);
  });
  const failed = await api.loadRoadTiles(
    [ride()],
    new AbortController().signal,
  );
  expect(failed.failed).toBeGreaterThan(0);
  expect(failed.roads).toEqual([]);
  vi.mocked(fetch).mockImplementation(normal);
  const retried = await api.loadRoadTiles(
    [ride()],
    new AbortController().signal,
  );
  expect(retried.failed).toBe(0);
  expect(retried.roads.length).toBeGreaterThan(0);
});
it("aborts stale work without returning partial results", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    api.loadRoadTiles([ride()], controller.signal),
  ).rejects.toThrow();
});

it("loads extra corridor tiles for plausible pauses but leaves unverified jumps unfilled", () => {
  const trace = ride();
  trace.segments = [
    [
      [120, -0.0009],
      [120.0002, -0.0009],
    ],
    [
      [120.0038, -0.0009],
      [120.0042, -0.0009],
    ],
  ].map((line, part) =>
    line.map(([lon, lat], i) => ({
      lon,
      lat,
      elevation: null,
      time: new Date(
        Date.UTC(2026, 9, 29) + (part * 120 + i * 10) * 1000,
      ).toISOString(),
    })),
  );
  const before = JSON.stringify(trace);
  expect(api.roadTilePlan([trace]).tiles.some((t) => t.y === 8191)).toBe(true);
  const unknown = {
    ...trace,
    segments: trace.segments.map((line) =>
      line.map((p) => ({ ...p, time: null })),
    ),
  };
  expect(api.roadTilePlan([unknown]).tiles.some((t) => t.y === 8191)).toBe(
    false,
  );
  expect(JSON.stringify(trace)).toBe(before);
});

it("loads a wider corridor only for long pauses supported by moving observations", () => {
  const trace = ride();
  trace.segments = [
    Array.from({ length: 16 }, (_, i) => [i * 6, i]),
    Array.from({ length: 16 }, (_, i) => [1770 + i * 3, 1285 + i]),
  ].map((line) =>
    line.map(([x, t]) => ({
      lon: 120 + x / 111195,
      lat: -0.002,
      elevation: null,
      time: new Date(Date.UTC(2026, 0, 1) + t * 1000).toISOString(),
    })),
  );
  const moving = api.roadTilePlan([trace]);
  expect(moving.tiles.some((t) => t.y === 8191)).toBe(true);
  trace.segments[0] = trace.segments[0].map((p) => ({ ...p, lon: 120 }));
  const startup = api.roadTilePlan([trace]);
  expect(startup.tiles.some((t) => t.y === 8191)).toBe(false);
  expect(startup.tiles.length).toBeLessThan(moving.tiles.length);
});

it("builds one centreline when opposite carriageways arrive in neighbouring tile buffers", async () => {
  vi.mocked(fetch).mockImplementation(
    async (url) =>
      ({
        ok: true,
        arrayBuffer: async () => {
          if (String(url).endsWith("/planet")) return metadata;
          const north = String(url).endsWith("/8191.pbf");
          const layer = new GeoJSONWrapper(
            [
              {
                id: north ? 1 : 2,
                type: 2,
                tags: { class: "primary", oneway: 1 },
                geometry: [
                  north
                    ? [
                        [-100, 4090],
                        [4200, 4090],
                      ]
                    : [
                        [4200, 6],
                        [-100, 6],
                      ],
                ],
              },
            ],
            { extent: 4096, version: 2 },
          );
          layer.name = "transportation";
          return fromVectorTileJs({ layers: { transportation: layer } }).slice()
            .buffer as ArrayBuffer;
        },
      }) as Response,
  );
  const result = await api.loadRoadTiles(
    [
      ride([
        [120, 0],
        [120.001, 0],
      ]),
    ],
    new AbortController().signal,
  );
  expect(result.failed).toBe(0);
  expect(result.roads).toHaveLength(1);
  expect(result.roads[0].properties?.oneway).toBe(0);
  if (result.roads[0].geometry.type !== "LineString")
    throw Error("Invalid fixture");
  expect(
    result.roads[0].geometry.coordinates.every((p) => Math.abs(p[1]) < 1e-6),
  ).toBe(true);
});
