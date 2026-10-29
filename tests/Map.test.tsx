import { act, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { Ride } from "../src/types";
import {
  HIT_LAYER,
  RIDES_SOURCE,
  ROUTES_LAYER,
  SELECTED_LAYER,
  ROUTES_CASING_LAYER,
  SELECTED_CASING_LAYER,
  MAP_STYLE,
} from "../src/mapData";
import { ROAD_SOURCE, ROAD_LAYER } from "../src/useRoadOverlay";
import {
  ROAD_CASING_LAYER,
  ROUTE_COLOR,
  SELECTED_ROUTE_COLOR,
} from "../src/heatData";
import { loadRoadTiles } from "../src/roadTiles";
import { singleRoadNetwork } from "../src/roadNetwork";
import { roadPalette } from "../src/mapTheme";
vi.mock("../src/roadTiles", () => ({
  loadRoadTiles: vi.fn(async () => ({ roads: [], failed: 0, omitted: 0 })),
}));
const roadFixture = {
  type: "Feature" as const,
  properties: { class: "minor" },
  geometry: {
    type: "LineString" as const,
    coordinates: [
      [120, 30],
      [120.001, 30],
    ],
  },
};
const mock = vi.hoisted(() => ({ instances: [] as any[], fail: false }));
vi.mock("maplibre-gl", () => ({
  AttributionControl: class {},
  Map: class {
    listeners = new Map<string, Function[]>();
    style: any;
    source = { setData: vi.fn() };
    roadSource = { setData: vi.fn() };

    canvas = { style: { cursor: "" } };
    fitBounds = vi.fn();
    resize = vi.fn();
    remove = vi.fn();
    zoomIn = vi.fn();
    zoomOut = vi.fn();
    addControl = vi.fn();
    setFilter = vi.fn();
    setLayoutProperty = vi.fn();
    setPaintProperty = vi.fn();
    getZoom = vi.fn(() => 15);
    isStyleLoaded = vi.fn(() => true);
    querySourceFeatures = vi.fn(() => []);
    getStyle() {
      return this.style;
    }
    addSource(id: string, source: any) {
      this.style.sources[id] = source;
    }
    addLayer(layer: any) {
      this.style.layers.push(layer);
    }
    off(name: string, fn: Function) {
      this.listeners.set(
        name,
        this.listeners.get(name)?.filter((f) => f !== fn) ?? [],
      );
    }
    queryRenderedFeatures = vi.fn(() => []);
    setStyle = vi.fn((style: any) => {
      this.style = style;
      this.emit("style.load");
    });
    constructor(options: any) {
      if (mock.fail) throw new Error("WebGL unavailable");
      this.style = options.style;
      mock.instances.push(this);
    }
    on(name: string, fn: Function) {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
      return this;
    }
    emit(name: string, event: any = {}) {
      this.listeners.get(name)?.forEach((fn) => fn(event));
    }
    getSource(id: string) {
      if (id === ROAD_SOURCE)
        return this.style.sources[id] ? this.roadSource : undefined;
      return this.style.sources[id] ? this.source : undefined;
    }
    getLayer(id: string) {
      return this.style.layers.find((layer: any) => layer.id === id);
    }
    getCanvas() {
      return this.canvas;
    }
  },
}));
import RideMap from "../src/Map";
import type { RoadMode } from "../src/useRoadOverlay";
function MapHarness(
  props: Omit<ComponentProps<typeof RideMap>, "roadMode" | "onRoadModeChange">,
) {
  const [roadMode, setRoadMode] = useState<RoadMode>("heat");
  return (
    <RideMap {...props} roadMode={roadMode} onRoadModeChange={setRoadMode} />
  );
}
let element: HTMLDivElement, root: Root;
const onSelect = vi.fn();
const onClearSelection = vi.fn();
const point = (lat: number, lon: number) => ({
  lat,
  lon,
  time: null,
  elevation: null,
});
const first: Ride = {
  id: "one",
  name: "One",
  date: null,
  distance: 1,
  duration: null,
  filename: "one.gpx",
  importedAt: "2026-10-01",
  segments: [
    [point(30, 120), point(30.1, 120.1)],
    [point(31, 121), point(31.1, 121.1)],
  ],
};
const second: Ride = {
  ...first,
  id: "two",
  segments: [[point(32, 122), point(32.1, 122.1)]],
};
const base = {
  version: 8,
  sources: {
    basemap: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
  },
  layers: [],
};
const response = () => ({ ok: true, json: async () => base });
beforeEach(() => {
  mock.instances = [];
  mock.fail = false;
  onSelect.mockClear();
  vi.mocked(loadRoadTiles)
    .mockReset()
    .mockResolvedValue({ roads: [roadFixture], failed: 0, omitted: 0 });
  onClearSelection.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});
async function render(
  rides = [first, second],
  selected: string | null = null,
  dark = false,
) {
  await act(async () =>
    root.render(
      <MapHarness
        rides={rides}
        selected={selected}
        onSelect={onSelect}
        onClearSelection={onClearSelection}
        fitKey={0}
        dark={dark}
      />,
    ),
  );
}
const paint = (map: any, id: string, key: string) =>
  map.setPaintProperty.mock.calls
    .filter((c: any[]) => c[0] === id && c[1] === key)
    .at(-1)?.[2] ?? map.getLayer(id).paint?.[key];
const layout = (map: any, id: string, key: string) =>
  map.setLayoutProperty.mock.calls
    .filter((c: any[]) => c[0] === id && c[1] === key)
    .at(-1)?.[2] ?? map.getLayer(id).layout?.[key];

it("draws segmented WGS84 routes, selects them, hides them and fits visible bounds", async () => {
  await render();
  const map = mock.instances[0];
  const features = map.style.sources[RIDES_SOURCE].data.features;
  expect(features).toHaveLength(2);
  expect(features[0].geometry.coordinates).toEqual([
    [
      [120, 30],
      [120.1, 30.1],
    ],
    [
      [121, 31],
      [121.1, 31.1],
    ],
  ]);
  expect(map.fitBounds).toHaveBeenLastCalledWith(
    [
      [120, 30],
      [122.1, 32.1],
    ],
    expect.anything(),
  );
  map.queryRenderedFeatures.mockReturnValue([
    { layer: { id: SELECTED_LAYER }, properties: { rideId: "two" } },
  ]);
  await act(async () => map.emit("click", { point: { x: 0, y: 0 } }));
  expect(onSelect).toHaveBeenCalledWith("two");
  await render([second], "two");
  expect(map.source.setData.mock.lastCall[0].features).toHaveLength(1);
  expect(map.setFilter).toHaveBeenCalledWith(SELECTED_LAYER, [
    "==",
    ["get", "rideId"],
    "two",
  ]);
  await render([]);
  expect(map.source.setData.mock.lastCall[0].features).toHaveLength(0);
});

it("switches vector styles while preserving the map instance and selected route", async () => {
  await render([first], "one");
  const map = mock.instances[0];
  await render([first], "one", true);
  expect(mock.instances).toHaveLength(1);
  expect(fetch).toHaveBeenLastCalledWith(MAP_STYLE, expect.anything());
  expect(map.style.sources[RIDES_SOURCE].data.features[0].id).toBe("one");
  expect(
    map.style.layers.find((l: any) => l.id === SELECTED_LAYER).filter,
  ).toEqual(["==", ["get", "rideId"], "one"]);
});
it("preserves original basemap geometry sources while applying the driving style through theme changes", async () => {
  const networkBase = {
    ...base,
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#fff" },
      },
      {
        id: "road",
        type: "line",
        source: "basemap",
        "source-layer": "transportation",
        paint: { "line-width": 12, "line-offset": 2, "line-color": "#aaaaaa" },
      },
    ],
  };
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => networkBase,
  } as Response);
  let roadShapes: unknown;
  for (const dark of [false, true]) {
    await render([], null, dark);
    const map = mock.instances[0];
    expect(map.style.sources.basemap.url).toBe(
      "https://tiles.openfreemap.org/planet",
    );
    expect(map.getLayer("road").layout.visibility).toBe("none");
    const roads = map.style.layers.filter((l: any) =>
      l.id.startsWith("rideweave-driving"),
    );
    expect(roads.length).toBeGreaterThan(0);
    const shapes = roads.map((l: any) => ({
      ...l,
      paint: { ...l.paint, "line-color": "theme" },
    }));
    if (roadShapes) expect(shapes).toEqual(roadShapes);
    else roadShapes = shapes;
    expect(map.getLayer("background").paint["background-color"]).toBe(
      roadPalette(dark).background,
    );
    expect(
      map.getLayer("rideweave-driving-basemap-ground-edge").paint["line-color"],
    ).toBe(roadPalette(dark).edge);
  }
  expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
    MAP_STYLE,
    MAP_STYLE,
  ]);
  expect(mock.instances).toHaveLength(1);
});
it("initializes the active raw or heat geometry before style.load on theme changes and offline fallback", async () => {
  await render();
  const map = mock.instances[0];
  // Delay style.load so assertions inspect the first renderable style, not the repair callback.
  map.setStyle.mockImplementation((style: any) => {
    map.style = style;
  });
  for (const dark of [true, false]) {
    await render([first, second], null, dark);
    expect(map.getLayer(ROUTES_LAYER).paint["line-opacity"]).toBe(0);
    expect(map.getLayer(ROUTES_LAYER).paint["line-opacity-transition"]).toEqual(
      { duration: 0, delay: 0 },
    );
    expect(map.getLayer(HIT_LAYER).layout.visibility).toBe("none");
  }
  vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
  await render([first, second], null, true);
  expect(map.getLayer(ROUTES_LAYER).paint["line-opacity"]).toBe(0);
  await act(async () => {
    Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent === "骑行路线")!
      .click();
  });
  await render([first, second], null, false);
  expect(map.getLayer(ROUTES_LAYER).paint["line-opacity"]).toBe(1);
  expect(map.getLayer(ROUTES_CASING_LAYER).paint["line-opacity"]).toBe(1);
  expect(map.getLayer(HIT_LAYER).layout.visibility).toBe("visible");
  await render([first, second], "one", true);
  expect(map.getLayer(ROUTES_LAYER).paint["line-opacity"]).toBe(0);
  expect(
    map.setFilter.mock.calls
      .filter((c: any[]) => c[0] === SELECTED_LAYER)
      .at(-1)?.[1],
  ).toEqual(["==", ["get", "rideId"], "one"]);
  expect(map.getLayer(SELECTED_LAYER).paint["line-opacity"]).toBe(1);
});
it("shows only matched road lines, preserves heat at any zoom and focuses selected routes", async () => {
  const near: Ride = {
    ...first,
    segments: [[point(30.00005, 120), point(30.00005, 120.001)]],
  };
  const other = { ...near, id: "two" };
  await render([near, other]);
  const map = mock.instances[0];
  expect(
    element
      .querySelector('[aria-label="轨迹显示方式"]')!
      .querySelectorAll("button"),
  ).toHaveLength(2);
  expect(element.textContent).not.toContain("道路贴合");
  expect(map.style.layers.some((l: any) => l.type === "heatmap")).toBe(false);
  expect(map.getLayer(ROAD_LAYER).paint["line-blur"]).toBe(0);
  const data = map.roadSource.setData.mock.lastCall[0];
  expect(data.features.length).toBeGreaterThan(0);
  expect(data.features.every((f: any) => f.properties.count === 2)).toBe(true);
  expect(
    data.features.every((f: any) =>
      f.geometry.coordinates.every((p: number[]) => Math.abs(p[1] - 30) < 1e-9),
    ),
  ).toBe(true);
  expect(map.setPaintProperty).toHaveBeenCalledWith(
    ROUTES_LAYER,
    "line-opacity",
    0,
  );
  expect(map.setLayoutProperty).toHaveBeenCalledWith(
    HIT_LAYER,
    "visibility",
    "none",
  );
  const writes = map.roadSource.setData.mock.calls.length;
  map.getZoom.mockReturnValue(6);
  await act(async () => map.emit("idle"));
  expect(map.roadSource.setData).toHaveBeenCalledTimes(writes);
  expect(map.querySourceFeatures).not.toHaveBeenCalled();
  map.queryRenderedFeatures.mockReturnValue([
    { layer: { id: ROAD_LAYER }, properties: { rideIds: '["two"]' } },
  ]);
  await act(async () => map.emit("click", { point: { x: 0, y: 0 } }));
  expect(onSelect).toHaveBeenCalledWith("two");
  await render([near, other], "two");
  expect(layout(map, ROAD_LAYER, "visibility")).toBe("none");
  expect(paint(map, SELECTED_LAYER, "line-opacity")).toBe(1);
  expect(
    map.source.setData.mock.lastCall[0].features.find(
      (f: any) => f.properties.rideId === "two",
    ).geometry.coordinates[0][0][1],
  ).toBe(30.00005);
  expect(map.setFilter).toHaveBeenCalledWith(HIT_LAYER, [
    "==",
    ["get", "rideId"],
    "two",
  ]);
  expect(map.fitBounds).toHaveBeenLastCalledWith(
    [
      [120, 30.00005],
      [120.001, 30.00005],
    ],
    expect.anything(),
  );
  await act(async () =>
    Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent === "骑行热区")!
      .click(),
  );
  expect(onClearSelection).toHaveBeenCalled();
  await render([near]);
  expect(
    map.roadSource.setData.mock.lastCall[0].features.every(
      (f: any) => f.properties.count === 1,
    ),
  ).toBe(true);
  await render([near], null, true);
  expect(map.getLayer(ROAD_LAYER)).toBeDefined();
  await render([]);
  expect(map.roadSource.setData.mock.lastCall[0].features).toEqual([]);
});

it("shows the original off-road GPX and closed pauses even when no map roads are available", async () => {
  const time = (t: number) =>
    new Date(Date.UTC(2026, 0, 1) + t * 1000).toISOString();
  const line = [0, 20, 40, 100, 120, 140].map((x, i) => ({
    ...point(30.0002, 120 + x / 111195),
    time: time(i < 3 ? i * 10 : 100 + (i - 3) * 10),
  }));
  const trace = { ...first, segments: [line] },
    before = JSON.stringify(trace);
  vi.mocked(loadRoadTiles).mockResolvedValue({
    roads: [],
    failed: 1,
    omitted: 0,
  });
  await render([trace]);
  const map = mock.instances[0];
  await act(async () =>
    Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent === "骑行路线")!
      .click(),
  );
  const coords =
    map.source.setData.mock.lastCall[0].features[0].geometry.coordinates;
  expect(coords.slice(0, 2)).toEqual([
    line.slice(0, 3).map((p) => [p.lon, p.lat]),
    line.slice(3).map((p) => [p.lon, p.lat]),
  ]);
  expect(coords[2]).toEqual([
    [line[2].lon, line[2].lat],
    [line[3].lon, line[3].lat],
  ]);
  expect(paint(map, ROUTES_LAYER, "line-opacity")).toBe(1);
  expect(layout(map, ROAD_LAYER, "visibility")).toBe("none");
  expect(element.querySelector(".tile-warning")).toBeNull();
  expect(element.textContent).not.toContain("重试道路");
  await render([trace], "one", true);
  expect(
    map.source.setData.mock.lastCall[0].features[0].geometry.coordinates,
  ).toEqual(coords);
  expect(element.querySelector(".tile-warning")).toBeNull();
  expect(JSON.stringify(trace)).toBe(before);
});

it("silently closes pauses while roads are loading and after a road request fails", async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(loadRoadTiles).mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  const line = [0, 20, 40, 100, 120, 140].map((x, i) => ({
    ...point(30.0002, 120 + x / 111195),
    time: new Date(
      Date.UTC(2026, 0, 1) + (i < 3 ? i * 10 : 100 + (i - 3) * 10) * 1000,
    ).toISOString(),
  }));
  const rides = [{ ...first, segments: [line] }];
  await render(rides);
  expect(element.textContent).toContain("正在加载道路");
  await act(async () =>
    Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent === "骑行路线")!
      .click(),
  );
  const map = mock.instances[0];
  const raw = map.source.setData.mock.lastCall[0];
  expect(raw.features[0].geometry.coordinates.at(-1)).toEqual([
    [line[2].lon, line[2].lat],
    [line[3].lon, line[3].lat],
  ]);
  expect(element.querySelector(".tile-warning")).toBeNull();
  await render(rides, "one", true);
  expect(map.source.setData.mock.lastCall[0]).toEqual(raw);
  expect(vi.mocked(loadRoadTiles)).toHaveBeenCalledOnce();
  await act(async () => reject(new Error("offline")));
  expect(map.source.setData.mock.lastCall[0]).toEqual(raw);
  expect(element.querySelector(".tile-warning")).toBeNull();
  expect(element.textContent).not.toContain("重试道路");
});

it("shows counted repeat passes with bright cased routes and restores heat styling through theme changes", async () => {
  const trace: Ride = {
    ...first,
    segments: [[point(30, 120), point(30, 120.001), point(30, 120)]],
  };
  await render([trace]);
  const map = mock.instances[0];
  const strokes = (ids: string[]) =>
    ids.map((id) => ({
      layout: map.getLayer(id).layout,
      paint: Object.fromEntries(
        Object.keys(map.getLayer(id).paint).map((key) => [
          key,
          paint(map, id, key),
        ]),
      ),
    }));
  const heatStyle = strokes([ROAD_CASING_LAYER, ROAD_LAYER]);
  const casingVisibility = () =>
    map.setLayoutProperty.mock.calls
      .filter(
        ([id, key]: string[]) =>
          id === ROAD_CASING_LAYER && key === "visibility",
      )
      .at(-1)?.[2];
  expect(
    map.roadSource.setData.mock.lastCall[0].features.every(
      (f: any) =>
        f.properties.count === 2 && f.properties.rideIds.join() === "one",
    ),
  ).toBe(true);
  expect(casingVisibility()).toBe("visible");
  await act(async () =>
    Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent === "骑行路线")!
      .click(),
  );
  expect(map.getLayer(ROUTES_LAYER).paint["line-color"]).toBe(ROUTE_COLOR);
  expect(paint(map, ROUTES_CASING_LAYER, "line-opacity")).toBe(1);
  expect(casingVisibility()).toBe("none");
  expect(
    map.style.layers.findIndex((l: any) => l.id === ROUTES_CASING_LAYER),
  ).toBeLessThan(map.style.layers.findIndex((l: any) => l.id === ROUTES_LAYER));
  expect(
    element.querySelector<HTMLElement>(".map-legend i")!.style.background,
  ).toBe("rgb(21, 223, 255)");
  const rawStyle = strokes([ROUTES_CASING_LAYER, ROUTES_LAYER]);
  await render([trace], null, true);
  expect(map.getLayer(ROAD_CASING_LAYER)).toBeDefined();
  expect(map.getLayer(ROUTES_LAYER).paint["line-color"]).toBe(ROUTE_COLOR);
  expect(strokes([ROUTES_CASING_LAYER, ROUTES_LAYER])).toEqual(rawStyle);
  await render([trace], "one", true);
  expect(map.getLayer(SELECTED_LAYER).paint["line-color"]).toBe(
    SELECTED_ROUTE_COLOR,
  );
  expect(map.getLayer(SELECTED_CASING_LAYER).paint["line-width"]).toBe(8);
  const selectedStyle = strokes([SELECTED_CASING_LAYER, SELECTED_LAYER]);
  await render([trace], "one", false);
  expect(strokes([SELECTED_CASING_LAYER, SELECTED_LAYER])).toEqual(
    selectedStyle,
  );
  map.queryRenderedFeatures.mockReturnValue([
    { layer: { id: SELECTED_CASING_LAYER }, properties: { rideId: "one" } },
  ]);
  await act(async () => map.emit("click", { point: { x: 0, y: 0 } }));
  expect(onSelect).toHaveBeenCalledWith("one");
  await render([trace], null, true);
  await act(async () =>
    Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent === "骑行热区")!
      .click(),
  );
  expect(casingVisibility()).toBe("visible");
  expect(strokes([ROAD_CASING_LAYER, ROAD_LAYER])).toEqual(heatStyle);
  expect(paint(map, ROUTES_LAYER, "line-opacity")).toBe(0);
  expect(element.textContent).not.toContain("补连");
});

it("does not invent heat when roads fail and keeps original routes usable without a road retry prompt", async () => {
  vi.mocked(loadRoadTiles).mockResolvedValueOnce({
    roads: [],
    failed: 1,
    omitted: 0,
  });
  const near = { ...first, segments: [[point(30, 120), point(30, 120.001)]] };
  await render([near]);
  const map = mock.instances[0];
  expect(map.roadSource.setData.mock.lastCall[0].features).toEqual([]);
  expect(element.textContent).toContain("道路加载失败");
  expect(element.textContent).not.toContain("重试道路");
  await act(async () =>
    Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent === "骑行路线")!
      .click(),
  );
  expect(paint(map, ROUTES_LAYER, "line-opacity")).toBe(1);
  expect(
    map.source.setData.mock.lastCall[0].features[0].geometry.coordinates,
  ).toEqual([near.segments[0].map((p) => [p.lon, p.lat])]);
  expect(element.textContent).not.toContain("道路加载失败");
});

it("centres heat on one road while preserving both original GPX geometries in route and selected views", async () => {
  const carriageways = [
    {
      type: "Feature" as const,
      properties: { class: "primary", oneway: 1 },
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [120, 30],
          [120.001, 30],
        ],
      },
    },
    {
      type: "Feature" as const,
      properties: { class: "primary", oneway: 1 },
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [120.001, 30.00016],
          [120, 30.00016],
        ],
      },
    },
  ];
  const a = { ...first, segments: [[point(30, 120), point(30, 120.001)]] };
  const b = {
    ...second,
    segments: [[point(30.00016, 120.001), point(30.00016, 120)]],
  };
  const networkBase = {
    ...base,
    layers: [
      {
        id: "road",
        type: "line",
        source: "basemap",
        "source-layer": "transportation",
        paint: { "line-width": 10, "line-offset": 2 },
      },
    ],
  };
  const before = JSON.stringify({ a, b, networkBase, carriageways });
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => networkBase,
  } as Response);
  vi.mocked(loadRoadTiles).mockResolvedValue({
    roads: singleRoadNetwork(carriageways),
    failed: 0,
    omitted: 0,
  });
  await render([a, b]);
  const map = mock.instances[0];
  const check = () => {
    const data = map.roadSource.setData.mock.lastCall[0];
    expect(data.features).toHaveLength(1);
    expect(
      data.features[0].geometry.coordinates.every(
        (p: number[]) => Math.abs(p[1] - 30.00008) < 1e-7,
      ),
    ).toBe(true);
    expect(map.getLayer("rideweave-driving-basemap-ground-edge").source).toBe(
      "basemap",
    );
    expect(
      map.getLayer("rideweave-driving-basemap-ground-edge")["source-layer"],
    ).toBe("transportation");
    expect(map.style.sources.basemap).toEqual(base.sources.basemap);
    const source = map.source.setData.mock.lastCall[0];
    expect(
      source.features.find((f: any) => f.properties.rideId === "one").geometry
        .coordinates,
    ).toEqual([a.segments[0].map((p) => [p.lon, p.lat])]);
    expect(
      source.features.find((f: any) => f.properties.rideId === "two").geometry
        .coordinates,
    ).toEqual([b.segments[0].map((p) => [p.lon, p.lat])]);
  };
  check();
  expect(
    map.roadSource.setData.mock.lastCall[0].features[0].properties.count,
  ).toBe(2);
  await act(async () =>
    Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent === "骑行路线")!
      .click(),
  );
  check();
  expect(paint(map, ROUTES_LAYER, "line-opacity")).toBe(1);
  expect(layout(map, ROAD_LAYER, "visibility")).toBe("none");
  await render([a, b], "one");
  check();
  expect(paint(map, ROUTES_LAYER, "line-opacity")).toBe(0);
  expect(paint(map, SELECTED_LAYER, "line-opacity")).toBe(1);
  expect(
    map.setFilter.mock.calls
      .filter((c: any[]) => c[0] === SELECTED_LAYER)
      .at(-1)?.[1],
  ).toEqual(["==", ["get", "rideId"], "one"]);
  expect(
    map.roadSource.setData.mock.lastCall[0].features.every((f: any) =>
      f.properties.rideIds.includes("one"),
    ),
  ).toBe(true);
  await render([a, b], "two", true);
  check();
  expect(
    map.roadSource.setData.mock.lastCall[0].features.every((f: any) =>
      f.properties.rideIds.includes("two"),
    ),
  ).toBe(true);
  expect(JSON.stringify({ a, b, networkBase, carriageways })).toBe(before);
});

it("ignores stale road matching after rides change or unmount", async () => {
  let resolve!: (r: any) => void;
  vi.mocked(loadRoadTiles).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await render([first]);
  const signal = vi.mocked(loadRoadTiles).mock.calls[0][1];
  await render([]);
  expect(signal.aborted).toBe(true);
  await act(async () =>
    resolve({ roads: [roadFixture], failed: 0, omitted: 0 }),
  );
  expect(mock.instances[0].style.sources[ROAD_SOURCE].data.features).toEqual(
    [],
  );
});

it("displays repaired pauses as ordinary solid routes without adding a pause legend in any mode", async () => {
  const timed = (lat: number, lon: number, t: number) => ({
    ...point(lat, lon),
    time: new Date(Date.UTC(2026, 9, 29) + t * 1000).toISOString(),
  });
  const a: Ride = {
    ...first,
    segments: [
      [timed(30, 120, 0), timed(30, 120.0004, 10), timed(30, 120.0008, 20)],
      [
        timed(30, 120.0016, 120),
        timed(30, 120.002, 130),
        timed(30, 120.0024, 140),
      ],
    ],
  };
  const b: Ride = {
    ...second,
    segments: [
      Array.from({ length: 7 }, (_, i) => timed(30, 120 + i * 0.0004, i * 10)),
    ],
  };
  const before = JSON.stringify([a, b]);
  vi.mocked(loadRoadTiles).mockResolvedValue({
    roads: [
      {
        ...roadFixture,
        geometry: {
          type: "LineString",
          coordinates: [
            [120, 30],
            [120.003, 30],
          ],
        },
      },
    ],
    failed: 0,
    omitted: 0,
  });
  await render([a]);
  const map = mock.instances[0];
  const repaired = map.roadSource.setData.mock.lastCall[0].features.filter(
    (f: any) => f.properties.inferred,
  );
  expect(repaired.length).toBeGreaterThan(0);
  expect(repaired.every((f: any) => f.properties.strength >= 1)).toBe(true);
  expect(element.textContent).not.toContain("暂停补连");
  expect(map.getLayer(ROAD_LAYER).filter).toBeUndefined();
  expect(map.getLayer(ROAD_LAYER).paint["line-dasharray"]).toBeUndefined();
  await render([a, b]);
  expect(
    map.roadSource.setData.mock.lastCall[0].features.every(
      (f: any) => !f.properties.inferred,
    ),
  ).toBe(true);
  await render([a, b], "one");
  expect(
    map.roadSource.setData.mock.lastCall[0].features.some((f: any) =>
      f.properties.inferredRideIds?.includes("one"),
    ),
  ).toBe(true);
  expect(element.textContent).not.toContain("暂停补连");
  expect(map.getLayer(ROAD_LAYER).paint["line-dasharray"]).toBeUndefined();
  expect(map.getLayer(SELECTED_LAYER).paint["line-color"]).toBe(
    SELECTED_ROUTE_COLOR,
  );
  expect(map.getLayer(SELECTED_LAYER).paint["line-width"]).toBe(6);
  map.queryRenderedFeatures.mockReturnValue([
    { layer: { id: SELECTED_LAYER }, properties: { rideId: "one" } },
  ]);
  await act(async () => map.emit("click", { point: { x: 0, y: 0 } }));
  expect(onSelect).toHaveBeenCalledWith("one");
  await render([a, b], "two");
  expect(
    map.roadSource.setData.mock.lastCall[0].features.every(
      (f: any) => !f.properties.inferred,
    ),
  ).toBe(true);
  expect(element.textContent).not.toContain("暂停补连");
  expect(JSON.stringify([a, b])).toBe(before);
});

it("uses the latest rides when a pending basemap finishes loading", async () => {
  let resolve!: (r: any) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await render([first]);
  await render([second], "two");
  await act(async () => resolve(response()));
  expect(
    mock.instances[0].style.sources[RIDES_SOURCE].data.features.map(
      (f: any) => f.id,
    ),
  ).toEqual(["two"]);
});
it("keeps local tracks on network failure and can retry the basemap", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
  await render([first]);
  const map = mock.instances[0];
  expect(element.textContent).toContain("本地骑行数据仍已保留");
  expect(map.style.sources[RIDES_SOURCE].data.features).toHaveLength(1);
  expect(map.style.sources.basemap).toBeUndefined();
  await act(async () =>
    Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent === "重试底图")!
      .click(),
  );
  expect(map.style.sources.basemap).toBeDefined();
  expect(element.textContent).not.toContain("本地骑行数据仍已保留");
});
it("ignores a stale theme response and disposes the map", async () => {
  let resolve!: (r: any) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await render();
  await render([second], "two", true);
  const map = mock.instances[0];
  const count = map.setStyle.mock.calls.length;
  await act(async () => resolve(response()));
  expect(map.setStyle).toHaveBeenCalledTimes(count);
  await act(async () => root.render(null));
  expect(map.remove).toHaveBeenCalledOnce();
});
it("reports unavailable WebGL without breaking the rest of the application", async () => {
  mock.fail = true;
  await render();
  expect(element.textContent).toContain("无法初始化矢量地图");
  expect(fetch).not.toHaveBeenCalled();
  expect(
    element.querySelector<HTMLButtonElement>('button[title="放大"]')?.disabled,
  ).toBe(true);
});
