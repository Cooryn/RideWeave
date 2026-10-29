import type { StyleSpecification } from "maplibre-gl";

export const DARK_MAP_BACKGROUND = "#26312a";
export const LIGHT_MAP_BACKGROUND = "#d9ddcf";
export const roadPalette = (dark: boolean) =>
  dark
    ? {
        background: DARK_MAP_BACKGROUND,
        land: "#2c382e",
        park: "#304733",
        wood: "#293e2e",
        water: "#284c55",
        building: "#3d493f",
        edge: "#eeeee4",
        surface: "#505c53",
        shadow: "#18241d",
        trail: "#e5a16d",
        label: "#e1e5d8",
        muted: "#839482",
      }
    : {
        background: LIGHT_MAP_BACKGROUND,
        land: "#d2d8c6",
        park: "#bdcba9",
        wood: "#b1c29e",
        water: "#a1bfc1",
        building: "#c2c9b8",
        edge: "#fffef5",
        surface: "#7c8977",
        shadow: "#61705b",
        trail: "#b86a39",
        label: "#354634",
        muted: "#8c9e83",
      };

/** Appearance only. Keep every map data source and its original geometry. */
export function roadMapTheme(
  style: StyleSpecification,
  dark: boolean,
): StyleSpecification {
  const p = roadPalette(dark);
  return {
    ...style,
    layers: style.layers.map((layer) => {
      const source =
        "source-layer" in layer ? layer["source-layer"] : undefined;
      if (layer.type === "background")
        return {
          ...layer,
          paint: { ...layer.paint, "background-color": p.background },
        };
      if (layer.type === "fill") {
        const color =
          source === "water"
            ? p.water
            : source === "building"
              ? p.building
              : /wood|forest/.test(layer.id)
                ? p.wood
                : /park|grass|garden/.test(layer.id)
                  ? p.park
                  : p.land;
        const paint = {
          ...layer.paint,
          "fill-color": color,
          "fill-opacity":
            source === "building"
              ? 0.42
              : source === "transportation"
                ? 0.28
                : 1,
        };
        delete paint["fill-pattern"];
        delete paint["fill-outline-color"];
        return { ...layer, paint };
      }
      if (layer.type === "line" && source !== "transportation")
        return {
          ...layer,
          paint: {
            ...layer.paint,
            "line-color": source === "waterway" ? p.water : p.muted,
            "line-opacity": source === "boundary" ? 0.2 : 0.45,
          },
        };
      if (layer.type === "symbol") {
        if (
          source === "poi" ||
          source === "housenumber" ||
          source === "transportation"
        )
          return { ...layer, layout: { ...layer.layout, visibility: "none" } };
        if (layer.layout?.["text-field"])
          return {
            ...layer,
            minzoom:
              source === "transportation_name"
                ? Math.max(14, layer.minzoom ?? 0)
                : layer.minzoom,
            paint: {
              ...layer.paint,
              "text-color": p.label,
              "text-opacity": source === "transportation_name" ? 0.78 : 0.9,
              "text-halo-color": p.background,
              "text-halo-width": 1.5,
              "text-halo-blur": 0.2,
            },
          };
      }
      return layer;
    }),
  };
}
