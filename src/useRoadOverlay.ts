import { useEffect, useMemo, useState, type RefObject } from "react";
import type { GeoJSONSource, Map } from "maplibre-gl";
import type { Ride } from "./types";
import {
  HIT_LAYER,
  ROUTES_LAYER,
  SELECTED_LAYER,
  selectionFilter,
} from "./mapData";
import { matchRoads, type RoadMatches } from "./roadMatching";
import {
  roadHeat,
  roadHeatLayer,
  roadHeatSource,
  ROAD_SOURCE,
  ROAD_LAYER,
} from "./heatData";
import { loadRoadTiles } from "./roadTiles";
export { ROAD_SOURCE, ROAD_LAYER } from "./heatData";
export type RoadMode = "gps" | "heat";
const empty: RoadMatches = { type: "FeatureCollection", features: [] };

export function useRoadOverlay(
  map: RefObject<Map | null>,
  rides: Ride[],
  selected: string | null,
  mode: RoadMode,
) {
  const [status, setStatus] = useState("");
  const [matches, setMatches] = useState<RoadMatches>(empty);
  const [retry, setRetry] = useState(0);
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
    setStatus("正在加载道路并连续匹配…");
    void (async () => {
      try {
        const loaded = await loadRoadTiles(rides, controller.signal);
        if (controller.signal.aborted) return;
        const data = matchRoads(rides, loaded.roads);
        if (controller.signal.aborted) return;
        setMatches(data);
        const partial = loaded.failed + loaded.omitted;
        setFailed(partial > 0);
        const max = data.features.reduce(
          (n, f) => Math.max(n, f.properties.count),
          0,
        );
        setStatus(
          max
            ? `最常骑路段：${max} 条不同骑行记录经过（同次往返只计一次）${partial ? " · 道路数据不完整" : ""}`
            : partial
              ? "道路加载失败，暂无匹配热区；可查看原始轨迹"
              : "暂无可匹配道路；可查看原始轨迹",
        );
      } catch {
        if (!controller.signal.aborted) {
          setStatus("道路加载失败，可重试或查看原始轨迹");
          setFailed(true);
        }
      }
    })();
    return () => controller.abort();
  }, [map, rides, retry]);
  const data = useMemo(() => roadHeat(matches), [matches]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const sync = () => {
      if (!m.getLayer(ROUTES_LAYER)) return;
      if (!m.getSource(ROAD_SOURCE)) {
        m.addSource(ROAD_SOURCE, roadHeatSource(data));
        m.addLayer(roadHeatLayer());
      } else (m.getSource(ROAD_SOURCE) as GeoJSONSource).setData(data);
      const heat = mode === "heat" && !selected;
      m.setLayoutProperty(ROAD_LAYER, "visibility", heat ? "visible" : "none");
      m.setPaintProperty(
        ROUTES_LAYER,
        "line-opacity",
        heat || selected ? 0 : 0.8,
      );
      m.setPaintProperty(SELECTED_LAYER, "line-opacity", 1);
      m.setLayoutProperty(HIT_LAYER, "visibility", heat ? "none" : "visible");
      m.setFilter(HIT_LAYER, selected ? selectionFilter(selected) : null);
    };
    m.on("style.load", sync);
    sync();
    return () => {
      m.off("style.load", sync);
    };
  }, [map, data, mode, selected]);
  return { status, failed, retry: () => setRetry((n) => n + 1) };
}
