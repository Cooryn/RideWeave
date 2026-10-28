import type { StyleSpecification } from "maplibre-gl";

export const DARK_MAP_BACKGROUND = "#222b35";

// Recolor the basemap before adding ride overlays; retain zoom rules and geometry.
export function readableDarkStyle(
  style: StyleSpecification,
): StyleSpecification {
  return {
    ...style,
    layers: style.layers.map((layer) => {
      if (layer.type === "background")
        return {
          ...layer,
          paint: { ...layer.paint, "background-color": DARK_MAP_BACKGROUND },
        };
      const source =
        "source-layer" in layer ? layer["source-layer"] : undefined;
      if (layer.type === "fill") {
        const color =
          source === "water"
            ? "#183f58"
            : source === "building"
              ? "#37434f"
              : layer.id.includes("park") || layer.id.includes("wood")
                ? "#29483f"
                : source === "landcover"
                  ? "#34434b"
                  : source === "transportation"
                    ? "#8795a1"
                    : "#2c3641";
        return {
          ...layer,
          paint: {
            ...layer.paint,
            "fill-color": color,
            ...(source === "building"
              ? { "fill-outline-color": "#526170" }
              : {}),
          },
        };
      }
      if (layer.type === "line") {
        const color =
          source === "waterway"
            ? "#39718e"
            : source === "boundary"
              ? "#8793a5"
              : layer.id.includes("casing")
                ? "#465361"
                : layer.id.includes("dashline")
                  ? DARK_MAP_BACKGROUND
                  : layer.id.includes("railway")
                    ? "#8995a3"
                    : layer.id.includes("motorway")
                      ? "#b1bbc5"
                      : layer.id.includes("major")
                        ? "#9caab7"
                        : layer.id.includes("path")
                          ? "#8fa59d"
                          : "#8393a3";
        return { ...layer, paint: { ...layer.paint, "line-color": color } };
      }
      if (layer.type === "symbol" && layer.layout?.["text-field"])
        return {
          ...layer,
          paint: {
            ...layer.paint,
            "text-color": source === "water_name" ? "#b6e0f0" : "#eef3f8",
            "text-halo-color": DARK_MAP_BACKGROUND,
            "text-halo-width": 1.5,
            "text-halo-blur": 0.3,
          },
        };
      return layer;
    }),
  };
}
