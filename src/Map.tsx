import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { LocateFixed, Plus, Minus } from "lucide-react";
import type { Ride } from "./types";
export default function RideMap({
  rides,
  selected,
  onSelect,
  fitKey,
}: {
  rides: Ride[];
  selected: string | null;
  onSelect: (id: string) => void;
  fitKey: number;
}) {
  const element = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    layer = useRef<L.LayerGroup | null>(null);
  const [tileError, setTileError] = useState(false);
  const select = useRef(onSelect);
  select.current = onSelect;
  useEffect(() => {
    const m = L.map(element.current!, { zoomControl: false }).setView(
      [30.25, 120.15],
      11,
    );
    map.current = m;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    })
      .on("tileerror", () => setTileError(true))
      .on("tileload", () => setTileError(false))
      .addTo(m);
    layer.current = L.layerGroup().addTo(m);
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(element.current!);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    layer.current?.clearLayers();
    for (const ride of [...rides].sort(
      (a, b) => Number(a.id === selected) - Number(b.id === selected),
    )) {
      for (const segment of ride.segments)
        L.polyline(
          segment.map((p) => [p.lat, p.lon] as L.LatLngTuple),
          {
            color: ride.id === selected ? "#005d44" : "#169b72",
            weight: ride.id === selected ? 6 : 3,
            opacity: ride.id === selected ? 1 : 0.65,
          },
        )
          .on("click", () => select.current(ride.id))
          .addTo(layer.current!);
    }
  }, [rides, selected]);
  useEffect(() => {
    const focus = selected ? rides.filter((r) => r.id === selected) : rides;
    const points = focus.flatMap((r) =>
      r.segments.flat().map((p) => [p.lat, p.lon] as L.LatLngTuple),
    );
    if (points.length)
      map.current?.fitBounds(L.latLngBounds(points), {
        padding: [48, 48],
        maxZoom: 16,
      });
  }, [selected, fitKey, rides]);
  return (
    <div className="map-wrap">
      <div ref={element} className="map" />
      <div className="map-label">
        <span className="live-dot" /> 我的骑行网络{" "}
        <span>{rides.length} 条可见路线</span>
      </div>
      <div className="map-controls">
        <button title="放大" onClick={() => map.current?.zoomIn()}>
          <Plus size={18} />
        </button>
        <button title="缩小" onClick={() => map.current?.zoomOut()}>
          <Minus size={18} />
        </button>
        <button
          title="适配可见路线"
          onClick={() => {
            const p = rides.flatMap((r) =>
              r.segments.flat().map((p) => [p.lat, p.lon] as L.LatLngTuple),
            );
            if (p.length) map.current?.fitBounds(p, { padding: [40, 40] });
          }}
        >
          <LocateFixed size={18} />
        </button>
      </div>
      {tileError && (
        <div className="tile-warning">
          底图暂时无法加载，请检查网络。已保存轨迹仍可查看。
        </div>
      )}
      <div className="map-legend">
        <i /> 已骑行路线 <span>每一程，都在连接你的城市</span>
      </div>
    </div>
  );
}
