import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { Ride } from "../src/types";
import {
  HIT_LAYER,
  RIDES_SOURCE,
  ROUTES_LAYER,
  SELECTED_LAYER,
} from "../src/mapData";
import { ROAD_SOURCE, ROAD_LAYER } from "../src/useRoadOverlay";
import { loadRoadTiles } from "../src/roadTiles";
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
      <RideMap
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
  expect(fetch).toHaveBeenLastCalledWith(
    expect.stringContaining("/dark"),
    expect.anything(),
  );
  expect(map.style.sources[RIDES_SOURCE].data.features[0].id).toBe("one");
  expect(
    map.style.layers.find((l: any) => l.id === SELECTED_LAYER).filter,
  ).toEqual(["==", ["get", "rideId"], "one"]);
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
  expect(map.setLayoutProperty).toHaveBeenCalledWith(
    ROAD_LAYER,
    "visibility",
    "none",
  );
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

it("does not invent heat when roads fail, and retries roads independently of the basemap", async () => {
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
  await act(async () =>
    Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent === "重试道路")!
      .click(),
  );
  expect(
    map.roadSource.setData.mock.lastCall[0].features.length,
  ).toBeGreaterThan(0);
  expect(element.textContent).not.toContain("道路加载失败");
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
  expect(element.textContent).toContain("本地轨迹视图");
  expect(map.style.sources[RIDES_SOURCE].data.features).toHaveLength(1);
  expect(map.style.sources.basemap).toBeUndefined();
  await act(async () =>
    Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent === "重试底图")!
      .click(),
  );
  expect(map.style.sources.basemap).toBeDefined();
  expect(element.textContent).not.toContain("本地轨迹视图");
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
