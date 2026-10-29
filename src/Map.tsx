import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Map as VectorMap,
  AttributionControl,
  Marker,
  type MapMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import { LocateFixed, Plus, Minus } from "lucide-react";
import type { Ride, RidePreviewPoint } from "./types";
import { drivingRoadStyle } from "./roadStyle";
import { useRoadOverlay, ROAD_LAYER, type RoadMode } from "./useRoadOverlay";
import {
  ROUTE_COLOR,
  SELECTED_ROUTE_COLOR,
  ROUTE_CASING_COLOR,
  ROAD_CASING_LAYER,
} from "./heatData";
import {
  HIT_LAYER,
  MAP_STYLE,
  SELECTED_LAYER,
  ROUTES_LAYER,
  ROUTES_CASING_LAYER,
  SELECTED_CASING_LAYER,
  localMapStyle,
  rideBounds,
  withRides,
} from "./mapData";

export default function RideMap({
  rides,
  selected,
  onSelect,
  onClearSelection,
  roadMode,
  onRoadModeChange,
  fitKey,
  active = true,
  dark = false,
  previewPoint = null,
}: {
  rides: Ride[];
  selected: string | null;
  onSelect: (id: string) => void;
  onClearSelection?: () => void;
  roadMode: RoadMode;
  onRoadModeChange: (mode: RoadMode) => void;
  fitKey: number;
  active?: boolean;
  dark?: boolean;
  previewPoint?: RidePreviewPoint | null;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<VectorMap | null>(null);
  const previewMarker = useRef<Marker | null>(null);
  const [error, setError] = useState("");
  const [fatal, setFatal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const displayMode = selected ? "route" : roadMode;
  const latest = useRef({ rides, selected, onSelect, displayMode });
  latest.current = { rides, selected, onSelect, displayMode };

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
          latest.current.displayMode,
        ),
        center: [120.15, 30.25],
        zoom: 11,
        maxZoom: 20,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        renderWorldCopies: false,
        // Our observer ignores hidden containers to retain the camera and canvas size.
        trackResize: false,
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
    const interactiveLayers = () =>
      (latest.current.displayMode === "heat"
        ? [ROAD_LAYER, ROAD_CASING_LAYER]
        : latest.current.selected
          ? [SELECTED_LAYER, SELECTED_CASING_LAYER, HIT_LAYER]
          : [ROUTES_LAYER, ROUTES_CASING_LAYER, HIT_LAYER]
      ).filter((id) => m.getLayer(id));
    m.on("click", (event: MapMouseEvent) => {
      const layers = interactiveLayers();
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
      const layers = interactiveLayers();
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
    const observer = new ResizeObserver(() => {
      if (element.current?.clientWidth && element.current.clientHeight)
        m.resize();
    });
    observer.observe(element.current!);
    fit();
    return () => {
      observer.disconnect();
      previewMarker.current?.remove();
      previewMarker.current = null;
      m.remove();
      map.current = null;
    };
    // A theme change reloads the style below, preserving the camera and map instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (active) map.current?.resize();
  }, [active]);

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
        const response = await fetch(MAP_STYLE, { signal: controller.signal });
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
          withRides(
            drivingRoadStyle(style, dark),
            latest.current.rides,
            latest.current.selected,
            latest.current.displayMode,
          ),
          { diff: false },
        );
      } catch {
        if (!active) return;
        setError("在线底图暂时无法加载，本地骑行数据仍已保留。联网后可重试。");
        m.setStyle(
          withRides(
            localMapStyle(dark),
            latest.current.rides,
            latest.current.selected,
            latest.current.displayMode,
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
    fit();
  }, [rides, selected, fitKey]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (
      !previewPoint ||
      previewPoint.rideId !== selected ||
      !rides.some((r) => r.id === selected) ||
      !Number.isFinite(previewPoint.lon + previewPoint.lat) ||
      Math.abs(previewPoint.lon) > 180 ||
      Math.abs(previewPoint.lat) > 90
    ) {
      previewMarker.current?.remove();
      previewMarker.current = null;
      return;
    }
    const coordinate: [number, number] = [previewPoint.lon, previewPoint.lat];
    if (!previewMarker.current) {
      const dot = document.createElement("div");
      dot.className = "ride-preview-marker";
      dot.setAttribute("aria-hidden", "true");
      previewMarker.current = new Marker({ element: dot, anchor: "center" })
        .setLngLat(coordinate)
        .addTo(m);
    } else previewMarker.current.setLngLat(coordinate);
  }, [previewPoint, selected, rides]);
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
            ["route", "骑行路线"],
            ["heat", "骑行热区"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            aria-pressed={displayMode === mode}
            onClick={() => {
              onRoadModeChange(mode);
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
      <div className="map-overlays">
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
        {(roadStatus.failed || roadStatus.loading) && (
          <div className="tile-warning" role="status">
            {roadStatus.status}
          </div>
        )}
        <div
          className="map-legend"
          title={
            displayMode === "heat" ? "颜色表示道路累计经过次数" : undefined
          }
        >
          {displayMode === "heat" ? (
            <>
              1 <i className="heat-scale" /> 10+
            </>
          ) : (
            <>
              <i
                style={{
                  background: selected ? SELECTED_ROUTE_COLOR : ROUTE_COLOR,
                  boxShadow: `0 0 0 1px ${ROUTE_CASING_COLOR}`,
                }}
              />
              {selected ? "所选骑行路线" : "骑行路线"}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
