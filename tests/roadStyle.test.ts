import { expect, it } from "vitest";
import {
  createExpression,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import type { StyleSpecification } from "maplibre-gl";
import { drivingRoadStyle } from "../src/roadStyle";

it("applies the Horizon-inspired appearance to both original carriageways without changing their source", () => {
  const base: StyleSpecification = {
    version: 8,
    sources: {
      basemap: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
    },
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
        paint: { "line-width": 10 },
      },
    ],
  };
  const before = JSON.stringify(base);
  for (const dark of [false, true]) {
    const style = drivingRoadStyle(base, dark);
    expect(validateStyleMin(style)).toEqual([]);
    expect(style.sources).toBe(base.sources);
    // Paved road caps must meet bridge/tunnel entrances without closing the pavement.
    const paved = style.layers.filter((layer) =>
      /-(shadow|edge|surface)(-streets)?$/.test(layer.id),
    );
    expect(paved.length).toBeGreaterThan(0);
    for (const layer of paved) {
      if (layer.type !== "line") throw new Error("Expected road layers");
      expect(layer.layout?.["line-cap"]).toBe("butt");
    }
    const edge = style.layers.find(
      (l) => l.id === "rideweave-driving-basemap-ground-edge",
    )!;
    const surface = style.layers.find(
      (l) => l.id === "rideweave-driving-basemap-ground-surface",
    )!;
    expect(edge).toMatchObject({
      source: "basemap",
      "source-layer": "transportation",
    });
    expect(surface).toMatchObject({
      source: "basemap",
      "source-layer": "transportation",
    });
    if (edge.type !== "line" || surface.type !== "line")
      throw new Error("Expected road layers");
    expect(edge.paint?.["line-color"]).not.toEqual(
      surface.paint?.["line-color"],
    );
    const filter = createExpression(edge.filter);
    if (filter.result === "error")
      throw new Error(JSON.stringify(filter.value));
    for (const oneway of [1, -1])
      expect(
        filter.value.evaluate(
          { zoom: 14 },
          { type: 2, properties: { class: "primary", oneway } },
        ),
      ).toBe(true);
  }
  expect(JSON.stringify(base)).toBe(before);
});
