// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Ride, Point } from "../src/types";
vi.mock("../src/storage", () => ({ loadOriginalGpx: vi.fn(async () => null) }));
import { loadOriginalGpx } from "../src/storage";
import RideCharts from "../src/RideCharts";
const point = (
  t: number,
  speed: number | null = 5,
  elevation: number | null = 10,
): Point => ({
  lat: 0,
  lon: t / 100000,
  time: new Date(Date.UTC(2026, 0, 1) + t * 1000).toISOString(),
  speed,
  elevation,
});
const trace = (points: Point[], id = "ride"): Ride => ({
  id,
  name: "骑行",
  date: null,
  duration: 20,
  distance: 0.1,
  segments: [points],
  filename: "test.gpx",
  importedAt: "",
});
let element: HTMLDivElement, root: Root;
const onPreview = vi.fn();
beforeEach(() => {
  onPreview.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(loadOriginalGpx).mockReset().mockResolvedValue(null);
  const bounds = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.getAttribute("role") === "tooltip"
        ? ({ width: 160, height: 80 } as DOMRect)
        : bounds.call(this);
    },
  );
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  element.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const render = async (ride: Ride) =>
  act(async () =>
    root.render(<RideCharts key={ride.id} ride={ride} onPreview={onPreview} />),
  );
const hover = async (
  index: number,
  x: number,
  y = 60,
  left = 0,
  width = 320,
) => {
  const svg = element.querySelectorAll(".ride-chart-plot svg")[index];
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
    left,
    width,
  } as DOMRect);
  await act(async () =>
    svg.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: y }),
    ),
  );
};

const progress = () =>
  element.querySelector<HTMLInputElement>('[aria-label="轨迹播放进度"]')!;
const clickPlayback = async () =>
  act(async () =>
    element.querySelector<HTMLButtonElement>(".ride-playback button")!.click(),
  );
const seek = async (position: number) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(progress(), String(position));
    progress().dispatchEvent(new Event("input", { bubbles: true }));
  });
const advance = async (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });

it("plays, pauses, seeks and replays with a simple progress bar and synchronized previews", async () => {
  vi.useFakeTimers();
  await render(trace([point(0), point(10), point(20)]));
  expect(element.querySelector(".ride-playback select")).toBeNull();
  await clickPlayback();
  await advance(1000);
  expect(Number(progress().value)).toBeCloseTo(1);
  expect(onPreview.mock.lastCall![0].lon).toBeCloseTo(0.00001);
  expect(element.querySelectorAll(".chart-cursor")).toHaveLength(2);
  await clickPlayback();
  await advance(1000);
  expect(Number(progress().value)).toBeCloseTo(1);
  await seek(10);
  expect(onPreview).toHaveBeenLastCalledWith({
    rideId: "ride",
    lon: 0.0001,
    lat: 0,
  });
  await clickPlayback();
  await advance(1000);
  expect(Number(progress().value)).toBeCloseTo(11);
  await advance(500);
  expect(Number(progress().value)).toBeCloseTo(11.5);
  await advance(10000);
  expect(Number(progress().value)).toBe(20);
  expect(
    element.querySelector(".ride-playback button")?.getAttribute("aria-label"),
  ).toBe("播放轨迹");
  expect(element.querySelector(".ride-playback button")?.textContent).toContain(
    "重播",
  );
  await clickPlayback();
  expect(Number(progress().value)).toBe(0);
  await advance(200);
  expect(Number(progress().value)).toBeCloseTo(0.2);
  await act(async () => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
  expect(onPreview).toHaveBeenLastCalledWith(null);
});

it("automatically completes a long uninterrupted ride within twenty seconds", async () => {
  vi.useFakeTimers();
  await render(trace(Array.from({ length: 101 }, (_, i) => point(i * 10))));
  await clickPlayback();
  await advance(19950);
  expect(Number(progress().value)).toBeCloseTo(997.5);
  expect(
    element.querySelector(".ride-playback button")?.getAttribute("aria-label"),
  ).toBe("暂停轨迹播放");
  await advance(50);
  expect(Number(progress().value)).toBe(1000);
  expect(element.querySelector(".ride-playback button")?.textContent).toContain(
    "重播",
  );
  expect(vi.getTimerCount()).toBe(0);
});

it("resumes after dragging while chart inspection leaves playback progress and state independent", async () => {
  vi.useFakeTimers();
  await render(trace([point(0, 1, 1), point(10, 5, 15), point(20, 9, 25)]));
  await clickPlayback();
  await advance(50);
  expect(Number(progress().value)).toBeCloseTo(0.05);
  await act(async () =>
    progress().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })),
  );
  await seek(15);
  await advance(500);
  expect(Number(progress().value)).toBe(15);
  await act(async () =>
    progress().dispatchEvent(new MouseEvent("pointerup", { bubbles: true })),
  );
  await advance(50);
  expect(Number(progress().value)).toBeCloseTo(15.05);
  await hover(0, 160);
  expect(Number(progress().value)).toBeCloseTo(15.05);
  const readout = () =>
    element.querySelector(".ride-playback-values")?.textContent;
  expect(readout()).toContain("32.4 km/h");
  expect(readout()).toContain("25.0 m");
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
    "18.0 km/h",
  );
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
    "15.0 m",
  );
  expect(
    element.querySelector(".ride-playback button")?.getAttribute("aria-label"),
  ).toBe("暂停轨迹播放");
  await advance(1000);
  expect(Number(progress().value)).toBeCloseTo(16.05);
  const svg = element.querySelector<SVGSVGElement>(".ride-chart-plot svg")!;
  await act(async () =>
    svg.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })),
  );
  expect(onPreview.mock.lastCall![0].lon).toBeCloseTo(0.0001605);
  await clickPlayback();
  const inspected = Number(progress().value);
  const pausedReadout = readout();
  await hover(0, 160);
  expect(Number(progress().value)).toBe(inspected);
  expect(readout()).toBe(pausedReadout);
  await advance(1000);
  expect(Number(progress().value)).toBe(inspected);
  await act(async () =>
    svg.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    ),
  );
  expect(Number(progress().value)).toBe(inspected);
  expect(onPreview).toHaveBeenLastCalledWith({
    rideId: "ride",
    lon: 0,
    lat: 0,
  });
  expect(readout()).toBe(pausedReadout);
});

it("leaves manually selected gaps unknown, skips them on playback and resets when the ride changes", async () => {
  vi.useFakeTimers();
  await render(trace([point(0), point(1), point(120), point(121)]));
  await seek(60);
  expect(onPreview).toHaveBeenLastCalledWith(null);
  expect(element.querySelector(".ride-playback-values")?.textContent).toContain(
    "无采样数据",
  );
  await hover(1, 314);
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
    "18.0 km/h",
  );
  expect(element.querySelector(".ride-playback-values")?.textContent).toContain(
    "无采样数据",
  );
  await clickPlayback();
  await advance(50);
  expect(Number(progress().value)).toBe(120);
  expect(onPreview).toHaveBeenLastCalledWith({
    rideId: "ride",
    lon: 0.0012,
    lat: 0,
  });
  await render(trace([point(0), point(10), point(20)], "other"));
  expect(Number(progress().value)).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(onPreview).toHaveBeenLastCalledWith(null);
});

it("replays untimed records in point order and disables records with no usable span", async () => {
  vi.useFakeTimers();
  await render(
    trace([point(0), point(10), point(20)].map((p) => ({ ...p, time: null }))),
  );
  expect(progress().max).toBe("2");
  await clickPlayback();
  await advance(500);
  expect(Number(progress().value)).toBeCloseTo(0.5);
  expect(onPreview.mock.lastCall![0].lon).toBeCloseTo(0.00005);
  await render(trace([], "empty"));
  expect(progress().disabled).toBe(true);
  expect(
    element.querySelector<HTMLButtonElement>(".ride-playback button")!.disabled,
  ).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("previews exact speed and height samples with a synchronized time cursor and keyboard navigation", async () => {
  await render(trace([point(0, 0, 5), point(10, 5, 15), point(20, 10, 20)]));
  expect(
    Array.from(element.querySelectorAll(".chart-axis-unit")).map(
      (unit) => unit.textContent,
    ),
  ).toEqual(["km/h", "m"]);
  expect(loadOriginalGpx).not.toHaveBeenCalled();
  await hover(0, 160);
  const tooltip = () => document.querySelector('[role="tooltip"]')?.textContent;
  expect(tooltip()).toContain("0:00:10");
  expect(tooltip()).toContain("18.0 km/h");
  expect(tooltip()).toContain("15.0 m");
  expect(onPreview).toHaveBeenLastCalledWith({
    rideId: "ride",
    lon: 0.0001,
    lat: 0,
  });
  const popup = () => document.querySelector<HTMLElement>('[role="tooltip"]')!;
  const firstLeft = parseFloat(popup().style.left);
  const firstTop = parseFloat(popup().style.top);
  expect(firstLeft).toBeGreaterThan(160);
  expect(firstTop).toBeGreaterThan(60);
  await hover(0, 180, 70);
  expect(parseFloat(popup().style.left)).toBeGreaterThan(firstLeft);
  expect(parseFloat(popup().style.top)).toBeGreaterThan(firstTop);
  for (const line of element.querySelectorAll(".chart-cursor"))
    expect(Number(line.getAttribute("x1"))).toBeCloseTo(180);
  expect(
    Array.from(element.querySelectorAll('[role="slider"]')).map((s) =>
      s.getAttribute("aria-valuenow"),
    ),
  ).toEqual(["10", "10"]);
  // The pointer stays between observations when the SVG is scaled or offset.
  await hover(0, 370, 70, 100, 480);
  for (const line of element.querySelectorAll(".chart-cursor"))
    expect(100 + (Number(line.getAttribute("x1")) / 320) * 480).toBeCloseTo(
      370,
    );
  expect(tooltip()).toContain("0:00:10");
  await hover(0, 101, 70, 100, 480);
  // The reserved value axis is not part of the timeline.
  expect(element.querySelector(".chart-cursor")).toBeNull();
  expect(onPreview).toHaveBeenLastCalledWith(null);
  const edgeX = window.innerWidth - 4,
    edgeY = window.innerHeight - 4;
  await hover(0, edgeX, edgeY, window.innerWidth - 320);
  expect(parseFloat(popup().style.left) + 160).toBeLessThan(edgeX);
  expect(parseFloat(popup().style.top) + 80).toBeLessThan(edgeY);
  const height = element.querySelectorAll(".ride-chart-plot svg")[1];
  await act(async () =>
    height.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    ),
  );
  expect(tooltip()).toContain("0:00:20");
  expect(tooltip()).toContain("36.0 km/h");
  expect(onPreview).toHaveBeenLastCalledWith({
    rideId: "ride",
    lon: 0.0002,
    lat: 0,
  });
  await act(async () => window.dispatchEvent(new Event("scroll")));
  expect(tooltip()).toBeUndefined();
  expect(onPreview).toHaveBeenLastCalledWith(null);
  await hover(1, 160);
  await act(async () =>
    height.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(tooltip()).toBeUndefined();
});

it("shows a sampling pause as missing rather than a zero speed or interpolated elevation", async () => {
  await render(trace([point(0), point(1), point(120), point(121)]));
  await hover(1, 160);
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
    "无采样数据",
  );
  expect(onPreview).toHaveBeenLastCalledWith(null);
  expect(document.querySelector('[role="tooltip"]')?.textContent).not.toContain(
    "km/h",
  );
  const svg = element.querySelectorAll(".ride-chart-plot svg")[1];
  await act(async () =>
    svg.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })),
  );
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await hover(1, 314);
  expect(onPreview).toHaveBeenLastCalledWith({
    rideId: "ride",
    lon: 0.00121,
    lat: 0,
  });
  await act(async () => root.render(null));
  expect(onPreview).toHaveBeenLastCalledWith(null);
});

it("restores recorded speeds from an older original without mutating saved geometry or statistics", async () => {
  const ride = trace([point(0, 1), point(10, 1)]);
  ride.segments[0].forEach((p) => {
    delete p.speed;
  });
  const before = JSON.stringify(ride);
  const raw = `<gpx><trk><trkseg>${ride.segments[0].map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"><time>${p.time}</time><ele>${p.elevation}</ele><extensions><speed>8</speed></extensions></trkpt>`).join("")}</trkseg></trk></gpx>`;
  vi.mocked(loadOriginalGpx).mockResolvedValue(raw);
  await render(ride);
  await hover(0, 314);
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
    "28.8 km/h",
  );
  expect(element.textContent).not.toContain("含估算");
  expect(loadOriginalGpx).toHaveBeenCalledWith(ride.id);
  expect(JSON.stringify(ride)).toBe(before);
});

it("ignores stale original data after selection changes and falls back gracefully if it is unavailable", async () => {
  let resolve!: (raw: string | null) => void;
  vi.mocked(loadOriginalGpx).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const first = trace([point(0), point(10)]);
  first.segments[0].forEach((p) => {
    delete p.speed;
  });
  await render(first);
  await render(trace([point(0, 10), point(10, 10)], "second"));
  await act(async () => resolve("<gpx>invalid</gpx>"));
  await hover(0, 314);
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
    "36.0 km/h",
  );
  vi.mocked(loadOriginalGpx).mockRejectedValue(new Error("unavailable"));
  await render(first);
  expect(element.textContent).toContain("含估算");
  await hover(0, 314);
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
    "估算速度",
  );
});

it("hides absent elevation in charts, playback and tooltips while keeping speed usable", async () => {
  await render(
    trace([
      { ...point(0, null, null), time: null },
      { ...point(10, null, null), time: null },
    ]),
  );
  expect(element.textContent).toContain("暂无速度数据");
  expect(element.textContent).not.toContain("海拔");
  expect(element.querySelector(".ride-chart-elevation")).toBeNull();
  await hover(0, 314);
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
    "第 2 点",
  );
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
    "暂无数据",
  );
  expect(document.querySelector('[role="tooltip"]')?.textContent).not.toContain(
    "海拔",
  );
  await seek(1);
  expect(element.querySelector(".ride-playback-values")?.textContent).toContain(
    "速度",
  );
  expect(
    element.querySelector(".ride-playback-values")?.textContent,
  ).not.toContain("海拔");
});

it("keeps genuine zero elevation visible even when the remaining heights are missing", async () => {
  await render(trace([point(0, 5, null), point(10, 5, 0), point(20, 5, null)]));
  expect(element.querySelector(".ride-chart-elevation")).not.toBeNull();
  await hover(1, 181);
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
    "0.0 m",
  );
  await seek(10);
  expect(element.querySelector(".ride-playback-values")?.textContent).toContain(
    "海拔 0.0 m",
  );
});
