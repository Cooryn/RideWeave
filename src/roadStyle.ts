import type {
  ExpressionSpecification,
  LayerSpecification,
  LineLayerSpecification,
  StyleSpecification,
} from "maplibre-gl";
import { roadMapTheme, roadPalette } from "./mapTheme";

const paved = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
  "service",
  "raceway",
];
const roadFilter: ExpressionSpecification = [
  "all",
  ["==", ["geometry-type"], "LineString"],
  ["match", ["get", "class"], paved, true, false],
  ["!=", ["get", "surface"], "unpaved"],
];
const trailFilter: ExpressionSpecification = [
  "all",
  ["==", ["geometry-type"], "LineString"],
  [
    "any",
    ["match", ["get", "class"], ["track", "path"], true, false],
    [
      "all",
      ["match", ["get", "class"], paved, true, false],
      ["==", ["get", "surface"], "unpaved"],
    ],
  ],
];

export function drivingRoadWidth(inset = 0): ExpressionSpecification {
  const at = (major: number, street: number): ExpressionSpecification => [
    "match",
    ["get", "class"],
    ["motorway", "trunk"],
    Math.max(0.35, major + 0.6 - inset),
    ["primary", "secondary", "tertiary"],
    Math.max(0.35, major - inset),
    Math.max(0.35, street - inset),
  ];
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    6,
    at(1.5, 0.8),
    11,
    at(3.2, 2),
    14,
    at(5.4, 3.9),
    17,
    at(7.2, 5.4),
    20,
    at(9, 6.6),
  ];
}

/** Draw the provider's original carriageways; centreline matching is separate. */
export function drivingRoadLayers(
  source: string,
  dark: boolean,
): LayerSpecification[] {
  const p = roadPalette(dark),
    layers: LayerSpecification[] = [];
  const make = (
    id: string,
    filter: ExpressionSpecification,
    color: string,
    width: number | ExpressionSpecification,
    opacity: number,
    minzoom = 5,
  ): LineLayerSpecification => ({
    id: `rideweave-driving-${source}-${id}`,
    type: "line",
    source,
    "source-layer": "transportation",
    filter,
    minzoom,
    layout: {
      // A separately cased bridge/tunnel must meet the adjacent pavement at
      // its exact endpoint. Round casing caps cover the existing road surface
      // and create pale capsule ends that look like breaks in the road.
      "line-cap": "butt",
      "line-join": "round",
      "line-sort-key": ["to-number", ["get", "layer"], 0],
    },
    paint: {
      "line-color": color,
      "line-width": width,
      "line-opacity": opacity,
      "line-gap-width": 0,
      "line-offset": 0,
      "line-blur": 0,
    },
  });
  for (const grade of ["tunnel", "ground", "bridge"] as const) {
    const level: ExpressionSpecification =
      grade === "ground"
        ? [
            "!",
            ["match", ["get", "brunnel"], ["bridge", "tunnel"], true, false],
          ]
        : ["==", ["get", "brunnel"], grade];
    const main: ExpressionSpecification = ["all", roadFilter, level];
    const opacity = grade === "tunnel" ? 0.46 : 1;
    for (const layer of [
      make(
        `${grade}-shadow`,
        main,
        p.shadow,
        drivingRoadWidth(-1.4),
        grade === "bridge" ? 0.95 : 0.5,
      ),
      make(`${grade}-edge`, main, p.edge, drivingRoadWidth(), opacity),
      make(`${grade}-surface`, main, p.surface, drivingRoadWidth(2), opacity),
    ]) {
      layer.filter = [
        "all",
        main,
        [
          "match",
          ["get", "class"],
          ["minor", "service", "raceway"],
          false,
          true,
        ],
      ];
      layers.push(layer);
      layers.push({
        ...layer,
        id: `${layer.id}-streets`,
        minzoom: 12,
        filter: [
          "all",
          main,
          [
            "match",
            ["get", "class"],
            ["minor", "service", "raceway"],
            true,
            false,
          ],
        ],
      });
    }
    const tracks = make(
      `${grade}-tracks`,
      ["all", trailFilter, level, ["!=", ["get", "class"], "path"]],
      p.trail,
      ["interpolate", ["linear"], ["zoom"], 11, 1.2, 15, 2.4, 20, 3.6],
      opacity,
      11,
    );
    const paths = make(
      `${grade}-paths`,
      ["all", trailFilter, level, ["==", ["get", "class"], "path"]],
      p.trail,
      ["interpolate", ["linear"], ["zoom"], 13, 1.2, 17, 1.8, 20, 2.4],
      opacity * 0.85,
      13,
    );
    paths.paint!["line-dasharray"] = [2.2, 1.6];
    // Trails are single strokes, so rounded tips cannot seal off a road core.
    tracks.layout!["line-cap"] = "round";
    paths.layout!["line-cap"] = "round";
    layers.push(tracks, paths);
  }
  return layers;
}

/** Restore the driving-map appearance without rewriting tiles or map sources. */
export function drivingRoadStyle(
  style: StyleSpecification,
  dark: boolean,
): StyleSpecification {
  const themed = roadMapTheme(style, dark),
    sources = new Set<string>();
  let insertion = -1;
  themed.layers.forEach((layer, i) => {
    if (
      "source-layer" in layer &&
      layer["source-layer"] === "transportation" &&
      layer.type === "line"
    ) {
      sources.add(layer.source);
      insertion = i;
    }
  });
  const layers: LayerSpecification[] = [];
  themed.layers.forEach((layer, i) => {
    if (
      "source-layer" in layer &&
      layer["source-layer"] === "transportation" &&
      layer.type === "line"
    ) {
      if (/rail|ferry|aerial|pier/i.test(layer.id))
        layers.push({
          ...layer,
          paint: {
            ...layer.paint,
            "line-color": roadPalette(dark).muted,
            "line-opacity": 0.35,
          },
        });
      else
        layers.push({
          ...layer,
          layout: { ...layer.layout, visibility: "none" },
        });
    } else layers.push(layer);
    if (i === insertion)
      for (const source of sources)
        layers.push(...drivingRoadLayers(source, dark));
  });
  return { ...themed, layers };
}
