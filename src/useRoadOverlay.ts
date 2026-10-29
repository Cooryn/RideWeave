import { useEffect, useMemo, useState, type RefObject } from "react";
import type { GeoJSONSource, Map } from "maplibre-gl";
import type { Ride } from "./types";
import {
  HIT_LAYER,
  ROUTES_LAYER,
  SELECTED_LAYER,
  RIDES_SOURCE,
  ROUTES_CASING_LAYER,
  SELECTED_CASING_LAYER,
  ridesGeoJSON,
  selectionFilter,
} from "./mapData";
import { matchRoads, type RoadMatches } from "./roadMatching";
import {
  roadHeat,
  roadHeatLayer,
  roadHeatSource,
  roadLineWidth,
  roadRouteCasingLayer,
  ROAD_SOURCE,
  ROAD_LAYER,
  ROAD_CASING_LAYER,
} from "./heatData";
import { loadRoadTiles } from "./roadTiles";
export { ROAD_SOURCE, ROAD_LAYER } from "./heatData";
export type RoadMode = "route" | "heat";
const empty: RoadMatches = { type: "FeatureCollection", features: [] };

export function useRoadOverlay(
  map: RefObject<Map | null>,
  rides: Ride[],
  selected: string | null,
  mode: RoadMode,
) {
  const [status, setStatus] = useState("");
  const [matches, setMatches] = useState<RoadMatches>(empty);
  const [failed, setFailed] = useState(false);
  // Road acquisition depends on saved tracks, not camera zoom or map theme.
  useEffect(() => {
    if (!map.current) return;
    const controller = new AbortController();
    setMatches(empty);
    setFailed(false);
    if (!rides.length) {
      setStatus("暂无可见骑行记录");
      return () => controller.abort();
    }
    setStatus("正在加载道路并生成骑行热区…");
    void (async () => {
      try {
        const loaded = await loadRoadTiles(rides, controller.signal);
        if (controller.signal.aborted) return;
        const data = matchRoads(rides, loaded.roads);
        if (controller.signal.aborted) return;
        setMatches(data);
        const partial = loaded.failed + loaded.omitted;
        const max = data.features.reduce(
          (n, f) => Math.max(n, f.properties.count, 1),
          0,
        );
        setFailed(partial > 0 || !max);
        setStatus(
          max
            ? `最常骑路段：累计经过 ${max} 次${partial ? " · 道路数据不完整" : ""}`
            : partial
              ? "道路加载失败，可切换骑行路线查看原始轨迹"
              : "暂无可匹配的道路，可切换骑行路线查看原始轨迹",
        );
      } catch {
        if (!controller.signal.aborted) {
          setStatus("道路加载失败，可切换骑行路线查看原始轨迹");
          setFailed(true);
        }
      }
    })();
    return () => controller.abort();
  }, [map, rides]);
  const data = useMemo(() => roadHeat(matches), [matches]);
  const rawData = useMemo(
    () => ridesGeoJSON(rides, matches.pauseLinks),
    [rides, matches],
  );
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const sync = () => {
      if (!m.getLayer(ROUTES_LAYER)) return;
      if (!m.getSource(ROAD_SOURCE)) {
        m.addSource(ROAD_SOURCE, roadHeatSource(data));
        m.addLayer(roadRouteCasingLayer());
        m.addLayer(roadHeatLayer());
      } else (m.getSource(ROAD_SOURCE) as GeoJSONSource).setData(data);
      (m.getSource(RIDES_SOURCE) as GeoJSONSource).setData(rawData);
      const heat = mode === "heat" && !selected;
      m.setLayoutProperty(ROAD_LAYER, "visibility", heat ? "visible" : "none");
      m.setLayoutProperty(
        ROAD_CASING_LAYER,
        "visibility",
        heat ? "visible" : "none",
      );
      m.setPaintProperty(ROAD_CASING_LAYER, "line-width", roadLineWidth(2));
      m.setPaintProperty(
        ROAD_LAYER,
        "line-color",
        roadHeatLayer().paint!["line-color"],
      );
      m.setPaintProperty(ROAD_LAYER, "line-width", roadLineWidth());
      for (const id of [ROUTES_LAYER, ROUTES_CASING_LAYER])
        m.setPaintProperty(id, "line-opacity", !heat && !selected ? 1 : 0);
      for (const id of [SELECTED_LAYER, SELECTED_CASING_LAYER]) {
        m.setPaintProperty(id, "line-opacity", !heat ? 1 : 0);
        m.setFilter(id, selectionFilter(selected));
      }
      m.setLayoutProperty(HIT_LAYER, "visibility", heat ? "none" : "visible");
      m.setFilter(HIT_LAYER, selected ? selectionFilter(selected) : null);
    };
    m.on("style.load", sync);
    sync();
    return () => {
      m.off("style.load", sync);
    };
  }, [map, data, rawData, mode, selected]);
  const loading = status.startsWith("正在");
  return {
    status,
    // Original GPX routes are usable immediately. Missing pause paths already
    // fall back to endpoint links, so road loading needs no prompt in this view.
    failed: mode === "heat" && !selected && failed,
    loading: mode === "heat" && !selected && loading,
  };
}
