import { expect, it } from "vitest";
import {
  createExpression,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import type { LineLayerSpecification, StyleSpecification } from "maplibre-gl";
import { drivingRoadLayers, drivingRoadStyle } from "../src/roadStyle";
import { roadPalette } from "../src/mapTheme";

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

// A centreline coverage probe follows the style's actual pass order and cap
// semantics. A round outer cap extends farther than the inner pavement cap,
// painting a white band across the road at each bridge entrance.
it("keeps bridge entrances continuous without drawing casing endcaps across the pavement", () => {
  const roads = [
    { from: -120, to: -40, properties: { class: "primary" } },
    { from: 40, to: 120, properties: { class: "primary" } },
    {
      from: -40,
      to: 40,
      properties: { class: "primary", brunnel: "bridge", layer: 1 },
    },
  ];
  const expressions = new Map<unknown, ReturnType<typeof createExpression>>();
  const evaluate = (
    value: unknown,
    properties: Record<string, unknown>,
    zoom: number,
  ) => {
    if (!Array.isArray(value)) return value;
    const parsed = expressions.get(value) ?? createExpression(value);
    expressions.set(value, parsed);
    if (parsed.result === "error")
      throw new Error(JSON.stringify(parsed.value));
    return parsed.value.evaluate({ zoom }, { type: 2, properties });
  };
  for (const dark of [false, true]) {
    const layers = drivingRoadLayers(
      "basemap",
      dark,
    ) as LineLayerSpecification[];
    const sample = (x: number, zoom: number) => {
      let color = roadPalette(dark).background;
      for (const layer of layers) {
        if ((layer.minzoom ?? 0) > zoom) continue;
        for (const road of roads) {
          if (!evaluate(layer.filter, road.properties, zoom)) continue;
          const width = evaluate(
            layer.paint?.["line-width"],
            road.properties,
            zoom,
          );
          const extension =
            layer.layout?.["line-cap"] === "round" ? width / 2 : 0;
          if (x > road.from - extension && x < road.to + extension)
            color = String(layer.paint?.["line-color"]);
        }
      }
      return color;
    };
    for (const zoom of [12, 14, 16, 19])
      for (const entrance of [-40, 40]) {
        for (let offset = -6; offset <= 6; offset += 0.125) {
          if (offset === 0) continue; // Exact edge antialiasing is renderer-dependent.
          expect(sample(entrance + offset, zoom)).toBe(
            roadPalette(dark).surface,
          );
        }
      }
  }
});
