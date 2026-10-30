// @vitest-environment jsdom
import { act, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { Ride, RidePreviewPoint } from "../src/types";
import {
  HIT_LAYER,
  RIDES_SOURCE,
  ROUTES_LAYER,
  SELECTED_LAYER,
  ROUTES_CASING_LAYER,
} from "../src/mapData";
import { ROAD_SOURCE, ROAD_LAYER } from "../src/useRoadOverlay";
import { loadRoadTiles } from "../src/roadTiles";
import {
  DARK_MAP_BACKGROUND,
  LIGHT_MAP_BACKGROUND,
  roadPalette,
} from "../src/mapTheme";
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
const mock = vi.hoisted(() => ({
  instances: [] as any[],
  markers: [] as any[],
  fail: false,
}));
vi.mock("maplibre-gl", () => ({
  AttributionControl: class {},
  Marker: class {
    element: HTMLElement;
    setLngLat = vi.fn(() => this);
    addTo = vi.fn(() => this);
    remove = vi.fn();
    constructor(options: { element: HTMLElement }) {
      this.element = options.element;
      mock.markers.push(this);
    }
  },
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
    isStyleLoaded = vi.fn(() => true);
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
let notifyResize: () => void;
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
  mock.markers = [];
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
      constructor(callback: () => void) {
        notifyResize = callback;
      }
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
  previewPoint: RidePreviewPoint | null = null,
  active = true,
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
        previewPoint={previewPoint}
        active={active}
      />,
    ),
  );
}
it("reuses the map and loaded roads after hiding, ignores zero-sized layouts and resizes on return", async () => {
  const rides = [first, second];
  await render(rides);
  const map = mock.instances[0];
  const fits = map.fitBounds.mock.calls.length;
  const styles = map.setStyle.mock.calls.length;
  await render(rides, null, false, null, false);
  notifyResize();
  expect(map.resize).not.toHaveBeenCalled();
  const canvasContainer = element.querySelector(".map")!;
  Object.defineProperties(canvasContainer, {
    clientWidth: { value: 900, configurable: true },
    clientHeight: { value: 550, configurable: true },
  });
  await render(rides);
  expect(map.resize).toHaveBeenCalledOnce();
  notifyResize();
  expect(map.resize).toHaveBeenCalledTimes(2);
  expect(mock.instances).toEqual([map]);
  expect(map.remove).not.toHaveBeenCalled();
  expect(map.fitBounds).toHaveBeenCalledTimes(fits);
  expect(map.setStyle).toHaveBeenCalledTimes(styles);
  expect(fetch).toHaveBeenCalledOnce();
  expect(loadRoadTiles).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  expect(map.remove).toHaveBeenCalledOnce();
});
const paint = (map: any, id: string, key: string) =>
  map.setPaintProperty.mock.calls
    .filter((c: any[]) => c[0] === id && c[1] === key)
    .at(-1)?.[2] ?? map.getLayer(id).paint?.[key];
const layout = (map: any, id: string, key: string) =>
  map.setLayoutProperty.mock.calls
    .filter((c: any[]) => c[0] === id && c[1] === key)
    .at(-1)?.[2] ?? map.getLayer(id).layout?.[key];

it("moves a preview dot on the selected original route without moving the camera and clears stale points", async () => {
  const rides = [first, second];
  const point = { rideId: "one", lon: 120, lat: 30 };
  await render(rides, "one");
  expect(mock.markers).toHaveLength(0);
  const map = mock.instances[0];
  const fits = map.fitBounds.mock.calls.length;
  await render(rides, "one", false, point);
  const marker = mock.markers[0];
  expect(marker.setLngLat).toHaveBeenLastCalledWith([120, 30]);
  expect(marker.addTo).toHaveBeenCalledWith(map);
  await render(rides, "one", false, { ...point, lon: 120.1, lat: 30.1 });
  expect(marker.setLngLat).toHaveBeenLastCalledWith([120.1, 30.1]);
  expect(mock.markers).toHaveLength(1);
  expect(map.fitBounds).toHaveBeenCalledTimes(fits);
  await render(rides, "one", true, point);
  expect(mock.markers).toHaveLength(1);
  expect(marker.remove).not.toHaveBeenCalled();
  await render(rides, "two", true, point);
  expect(marker.remove).toHaveBeenCalledOnce();
  expect(mock.markers).toHaveLength(1);
  await render(rides, "one", true, point);
  await render(rides, "one", true, null);
  expect(mock.markers[1].remove).toHaveBeenCalledOnce();
  await render([second], "one", true, point);
  expect(mock.markers).toHaveLength(2);
  await render(rides, "one", true, point);
  await act(async () => root.render(null));
  expect(mock.markers[2].remove).toHaveBeenCalledOnce();
});

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

it("preserves the active raw or heat geometry through theme changes", async () => {
  await render();
  const map = mock.instances[0];
  for (const dark of [true, false]) {
    await render([first, second], null, dark);
    expect(paint(map, ROUTES_LAYER, "line-opacity")).toBe(0);
    expect(map.getLayer(ROUTES_LAYER).paint["line-opacity-transition"]).toEqual(
      { duration: 0, delay: 0 },
    );
    expect(layout(map, HIT_LAYER, "visibility")).toBe("none");
  }
  await render([first, second], null, true);
  expect(paint(map, ROUTES_LAYER, "line-opacity")).toBe(0);
  await act(async () => {
    Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent === "骑行路线")!
      .click();
  });
  await render([first, second], null, false);
  expect(paint(map, ROUTES_LAYER, "line-opacity")).toBe(1);
  expect(paint(map, ROUTES_CASING_LAYER, "line-opacity")).toBe(1);
  expect(layout(map, HIT_LAYER, "visibility")).toBe("visible");
  await render([first, second], "one", true);
  expect(paint(map, ROUTES_LAYER, "line-opacity")).toBe(0);
  expect(
    map.setFilter.mock.calls
      .filter((c: any[]) => c[0] === SELECTED_LAYER)
      .at(-1)?.[1],
  ).toEqual(["==", ["get", "rideId"], "one"]);
  expect(paint(map, SELECTED_LAYER, "line-opacity")).toBe(1);
  expect(mock.instances).toHaveLength(1);
});
it("transitions loaded basemap colors without reloading styles, tiles or moving the camera", async () => {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      ...base,
      layers: [
        {
          id: "background",
          type: "background",
          paint: { "background-color": "#fff" },
        },
        {
          id: "water",
          type: "fill",
          source: "basemap",
          "source-layer": "water",
          paint: { "fill-color": "#fff" },
        },
      ],
    }),
  } as Response);
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
  const rides = [first];
  await render(rides);
  const map = mock.instances[0];
  const styles = map.setStyle.mock.calls.length;
  const fits = map.fitBounds.mock.calls.length;
  const sources = map.style.sources;
  for (const dark of [true, false, true]) {
    await render(rides, null, dark);
    expect(paint(map, "background", "background-color")).toBe(
      dark ? DARK_MAP_BACKGROUND : LIGHT_MAP_BACKGROUND,
    );
    expect(paint(map, "water", "fill-color")).toBe(roadPalette(dark).water);
    expect(paint(map, "water", "fill-color-transition")).toEqual({
      duration: 280,
      delay: 0,
    });
  }
  expect(fetch).toHaveBeenCalledOnce();
  expect(loadRoadTiles).toHaveBeenCalledOnce();
  expect(map.setStyle).toHaveBeenCalledTimes(styles);
  expect(map.fitBounds).toHaveBeenCalledTimes(fits);
  expect(map.style.sources).toBe(sources);
  expect(mock.instances).toEqual([map]);

  vi.mocked(window.matchMedia).mockReturnValue({
    matches: true,
  } as MediaQueryList);
  await render(rides);
  expect(paint(map, "background", "background-color")).toBe(
    LIGHT_MAP_BACKGROUND,
  );
  expect(paint(map, "water", "fill-color-transition")).toEqual({
    duration: 0,
    delay: 0,
  });
});
it("switches between heat and original routes and focuses selected rides", async () => {
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
  expect(mock.instances[0].style.sources[ROAD_SOURCE].data.features).toEqual(
    [],
  );
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
  await render(rides);
  await act(async () =>
    Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent === "骑行热区")!
      .click(),
  );
  expect(element.textContent).toContain("道路加载失败");
  expect(map.roadSource.setData.mock.lastCall[0].features).toEqual([]);
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
  expect(element.textContent).toContain("本地骑行数据仍已保留");
  expect(map.style.sources[RIDES_SOURCE].data.features).toHaveLength(1);
  expect(map.style.sources.basemap).toBeUndefined();
  await render([first], null, true);
  expect(paint(map, "background", "background-color")).toBe(
    DARK_MAP_BACKGROUND,
  );
  expect(fetch).toHaveBeenCalledOnce();
  await act(async () =>
    Array.from(element.querySelectorAll("button"))
      .find((b) => b.textContent === "重试底图")!
      .click(),
  );
  expect(map.style.sources.basemap).toBeDefined();
  expect(element.textContent).not.toContain("本地骑行数据仍已保留");
});
it("applies the latest theme to an in-flight style response and disposes the map", async () => {
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
  expect(fetch).toHaveBeenCalledOnce();
  await act(async () =>
    resolve({
      ok: true,
      json: async () => ({
        ...base,
        layers: [{ id: "background", type: "background" }],
      }),
    }),
  );
  expect(map.setStyle).toHaveBeenCalledTimes(count + 1);
  expect(map.getLayer("background").paint["background-color"]).toBe(
    DARK_MAP_BACKGROUND,
  );
  expect(
    map.style.sources[RIDES_SOURCE].data.features.map((f: any) => f.id),
  ).toEqual(["two"]);
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
