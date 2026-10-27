import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import L from "leaflet";
import RideMap from "../src/Map";
import type { Ride } from "../src/types";
it("renders every segment as a separate interactive path and removes hidden rides", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const originalSvg = L.Browser.svg;
  Object.defineProperty(L.Browser, "svg", { value: true, configurable: true });
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const onSelect = vi.fn();
  const point = (lat: number, lon: number) => ({
    lat,
    lon,
    time: null,
    elevation: null,
  });
  const first: Ride = {
    id: "one",
    name: "one",
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
  try {
    await act(async () =>
      root.render(
        <RideMap
          rides={[first, second]}
          selected={null}
          onSelect={onSelect}
          fitKey={0}
        />,
      ),
    );
    expect(element.querySelectorAll("path.leaflet-interactive")).toHaveLength(
      3,
    );
    await act(async () =>
      element
        .querySelector("path.leaflet-interactive")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(onSelect).toHaveBeenCalledWith("one");
    await act(async () =>
      root.render(
        <RideMap
          rides={[second]}
          selected={null}
          onSelect={onSelect}
          fitKey={1}
        />,
      ),
    );
    expect(element.querySelectorAll("path.leaflet-interactive")).toHaveLength(
      1,
    );
  } finally {
    await act(async () => root.unmount());
    element.remove();
    Object.defineProperty(L.Browser, "svg", { value: originalSvg });
    vi.unstubAllGlobals();
  }
});
