import { useEffect, useRef, useState } from "react";
import {
  Map as VectorMap,
  AttributionControl,
  type GeoJSONSource,
  type MapMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import { LocateFixed, Plus, Minus } from "lucide-react";
import type { Ride } from "./types";
import { useRoadOverlay, ROAD_LAYER, type RoadMode } from "./useRoadOverlay";
import {
  HIT_LAYER,
  MAP_STYLES,
  RIDES_SOURCE,
  SELECTED_LAYER,
  localMapStyle,
  rideBounds,
  ridesGeoJSON,
  selectionFilter,
  withRides,
} from "./mapData";

export default function RideMap({
  rides,
  selected,
  onSelect,
  onClearSelection,
  fitKey,
  dark = false,
}: {
  rides: Ride[];
  selected: string | null;
  onSelect: (id: string) => void;
  onClearSelection?: () => void;
  fitKey: number;
  dark?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<VectorMap | null>(null);
  const latest = useRef({ rides, selected, onSelect });
  latest.current = { rides, selected, onSelect };
  const [error, setError] = useState("");
  const [fatal, setFatal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [roadMode, setRoadMode] = useState<RoadMode>("heat");
  const displayMode = selected ? "gps" : roadMode;

  function fit(all = false) {
    const current = latest.current;
    const bounds = rideBounds(
      !all && current.selected
        ? current.rides.filter((r) => r.id === current.selected)
        : current.rides,
    );
    if (bounds)
      map.current?.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });
  }

  useEffect(() => {
    let m: VectorMap;
    try {
      m = new VectorMap({
        container: element.current!,
        style: withRides(
          localMapStyle(dark),
          latest.current.rides,
          latest.current.selected,
        ),
        center: [120.15, 30.25],
        zoom: 11,
        maxZoom: 20,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        renderWorldCopies: false,
      });
    } catch {
      setFatal(true);
      setLoading(false);
      setError(
        "无法初始化矢量地图，请更新 WebView2 或显卡驱动后重启应用。历史记录和统计仍可使用。",
      );
      return;
    }
    map.current = m;
    m.addControl(
      new AttributionControl({
        compact: false,
        customAttribution:
          '<a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> · &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
      }),
      "bottom-right",
    );
    const sync = () => {
      const current = latest.current;
      (m.getSource(RIDES_SOURCE) as GeoJSONSource | undefined)?.setData(
        ridesGeoJSON(current.rides),
      );
      if (m.getLayer(SELECTED_LAYER))
        m.setFilter(SELECTED_LAYER, selectionFilter(current.selected));
    };
    m.on("style.load", sync);
    m.on("click", (event: MapMouseEvent) => {
      const layers = [ROAD_LAYER, SELECTED_LAYER, HIT_LAYER].filter((id) =>
        m.getLayer(id),
      );
      if (!layers.length) return;
      const features = m.queryRenderedFeatures(event.point, { layers });
      const feature =
        features.find((f) => f.layer.id === SELECTED_LAYER) ?? features[0];
      let id = feature?.properties?.rideId;
      if (!id && features[0]?.properties?.rideIds) {
        const value = features[0].properties.rideIds;
        try {
          const ids = typeof value === "string" ? JSON.parse(value) : value;
          if (Array.isArray(ids))
            id = ids.includes(latest.current.selected)
              ? latest.current.selected
              : ids[0];
        } catch {
          /* Ignore malformed external feature properties. */
        }
      }
      if (
        typeof id === "string" &&
        latest.current.rides.some((r) => r.id === id)
      )
        latest.current.onSelect(id);
    });
    m.on("mousemove", (event: MapMouseEvent) => {
      const layers = [ROAD_LAYER, HIT_LAYER].filter((id) => m.getLayer(id));
      m.getCanvas().style.cursor =
        layers.length && m.queryRenderedFeatures(event.point, { layers }).length
          ? "pointer"
          : "";
    });
    m.on("error", () => {
      setLoading(false);
      setError(
        "部分地图资源未能加载，请检查网络后重试。本地骑行记录仍可使用。",
      );
    });
    m.on("webglcontextlost", () => {
      setLoading(false);
      setError("地图图形渲染已中断，请重启应用。本地骑行记录仍可使用。");
    });
    const observer = new ResizeObserver(() => m.resize());
    observer.observe(element.current!);
    fit();
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
    // A theme change reloads the style below, preserving the camera and map instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const controller = new AbortController();
    let active = true;
    setError("");
    setLoading(true);
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    void (async () => {
      try {
        const response = await fetch(
          dark ? MAP_STYLES.dark : MAP_STYLES.light,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const style = (await response.json()) as StyleSpecification;
        if (
          style.version !== 8 ||
          !Array.isArray(style.layers) ||
          !style.sources
        )
          throw new Error("Invalid map style");
        if (!active) return;
        m.setStyle(
          withRides(style, latest.current.rides, latest.current.selected),
          { diff: false },
        );
      } catch {
        if (!active) return;
        setError("在线底图暂时无法加载，已切换为本地轨迹视图。联网后可重试。");
        m.setStyle(
          withRides(
            localMapStyle(dark),
            latest.current.rides,
            latest.current.selected,
          ),
          { diff: false },
        );
      } finally {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [dark, retry]);

  useEffect(() => {
    const m = map.current;
    if (m) {
      (m.getSource(RIDES_SOURCE) as GeoJSONSource | undefined)?.setData(
        ridesGeoJSON(rides),
      );
      if (m.getLayer(SELECTED_LAYER))
        m.setFilter(SELECTED_LAYER, selectionFilter(selected));
    }
  }, [rides, selected]);
  useEffect(() => {
    fit();
  }, [rides, selected, fitKey]);
  const roadStatus = useRoadOverlay(map, rides, selected, displayMode);

  return (
    <div className="map-wrap">
      <div ref={element} className="map" aria-label="骑行矢量地图" />
      <div className="map-label">
        <span className="live-dot" /> 我的骑行网络{" "}
        <span>{rides.length} 条可见路线</span>
      </div>
      <div className="road-mode" role="group" aria-label="轨迹显示方式">
        {(
          [
            ["gps", "原始轨迹"],
            ["heat", "骑行热区"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            aria-pressed={displayMode === mode}
            onClick={() => {
              setRoadMode(mode);
              onClearSelection?.();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="map-controls">
        <button
          title="放大"
          disabled={fatal}
          onClick={() => map.current?.zoomIn()}
        >
          <Plus size={18} />
        </button>
        <button
          title="缩小"
          disabled={fatal}
          onClick={() => map.current?.zoomOut()}
        >
          <Minus size={18} />
        </button>
        <button
          title={selected ? "居中所选路线" : "适配可见路线"}
          disabled={fatal}
          onClick={() => fit()}
        >
          <LocateFixed size={18} />
        </button>
      </div>
      {(error || loading) && (
        <div className="tile-warning" role="status">
          {error || "正在加载矢量底图…"}
          {error && !fatal && (
            <button className="subtle" onClick={() => setRetry((n) => n + 1)}>
              重试底图
            </button>
          )}
        </div>
      )}
      <div className="map-legend">
        {displayMode === "heat" ? (
          <>
            1 <i className="heat-scale" /> 10+ 条重合记录
          </>
        ) : (
          <>
            <i />
            {selected ? "所选路线" : "原始 GPS 轨迹"}
          </>
        )}
        {displayMode !== "gps" && (
          <small role="status">
            {roadStatus.status}
            {roadStatus.failed && (
              <button className="subtle" onClick={roadStatus.retry}>
                重试道路
              </button>
            )}
          </small>
        )}
      </div>
    </div>
  );
}
