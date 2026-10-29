import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Play, Pause } from "lucide-react";
import type { Ride, RidePreviewPoint } from "./types";
import { gpxSegments } from "./gpx";
import { loadOriginalGpx } from "./storage";
import {
  profileBins,
  profilePositionLabel,
  profileSampleAt,
  profilePlaybackAt,
  profileValueScale,
  rideProfile,
  type ProfileMetric,
} from "./rideProfile";
import { useRidePlayback } from "./useRidePlayback";

const CHART = {
  width: 320,
  height: 122,
  left: 48,
  right: 314,
  top: 22,
  bottom: 110,
};
const plotWidth = CHART.right - CHART.left;

const format = (n: number | null, digits = 1) =>
  n === null
    ? "暂无数据"
    : n.toLocaleString("zh-CN", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });

function ChartTooltip({
  anchor,
  metric,
  children,
}: {
  anchor: { x: number; y: number };
  metric: ProfileMetric;
  children: ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tooltip = element.current;
    if (!tooltip) return;
    const bounds = tooltip.getBoundingClientRect();
    const width = document.documentElement.clientWidth || window.innerWidth;
    const height = document.documentElement.clientHeight || window.innerHeight;
    const gap = 16,
      margin = 8;
    const x =
      anchor.x + gap + bounds.width <= width - margin
        ? anchor.x + gap
        : anchor.x - gap - bounds.width;
    const y =
      anchor.y + gap + bounds.height <= height - margin
        ? anchor.y + gap
        : anchor.y - gap - bounds.height;
    tooltip.style.left = `${Math.max(margin, Math.min(x, width - margin - bounds.width))}px`;
    tooltip.style.top = `${Math.max(margin, Math.min(y, height - margin - bounds.height))}px`;
  }, [anchor, children]);
  // A portal escapes the detail panel's scroll clipping; fixed coordinates use
  // the pointer's actual position, independently of the nearest sample's time.
  return createPortal(
    <div
      ref={element}
      className={`chart-tooltip chart-tooltip-${metric}`}
      role="tooltip"
    >
      {children}
    </div>,
    document.body,
  );
}

export default function RideCharts({
  ride,
  onPreview,
}: {
  ride: Ride;
  onPreview?: (point: RidePreviewPoint | null) => void;
}) {
  const [recorded, setRecorded] = useState<{
    original: Ride["segments"];
    segments: Ride["segments"];
  } | null>(null);
  const [cursor, setCursor] = useState<{
    position: number;
    metric: ProfileMetric;
    plotX: number;
    anchor: { x: number; y: number };
  } | null>(null);
  useEffect(() => {
    const hide = () => setCursor(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setCursor(null);
    if (!ride.segments.some((s) => s.some((p) => p.speed === undefined)))
      return;
    void loadOriginalGpx(ride.id)
      .then((raw) => {
        if (!active || !raw) return;
        const parsed = gpxSegments(raw);
        // Keep saved geometry/statistics authoritative. Attach telemetry only if
        // every point still corresponds to the saved original, in the same order.
        if (
          parsed.length !== ride.segments.length ||
          parsed.some(
            (s, i) =>
              s.length !== ride.segments[i].length ||
              s.some((p, j) => {
                const saved = ride.segments[i][j];
                return (
                  p.lat !== saved.lat ||
                  p.lon !== saved.lon ||
                  p.time !== saved.time
                );
              }),
          )
        )
          return;
        setRecorded({
          original: ride.segments,
          segments: ride.segments.map((s, i) =>
            s.map((p, j) => ({
              ...p,
              speed: p.speed === undefined ? parsed[i][j].speed : p.speed,
            })),
          ),
        });
      })
      .catch(() => {
        // Coordinate-based estimates remain explicitly identified in the chart.
      });
    return () => {
      active = false;
    };
  }, [ride.id, ride.segments]);
  const profile = useMemo(
    () =>
      rideProfile(
        recorded?.original === ride.segments
          ? { ...ride, segments: recorded.segments }
          : ride,
      ),
    [ride, recorded],
  );
  const bins = useMemo(() => profileBins(profile), [profile]);
  const hasElevation = profile.elevationRange !== null;
  const metrics: ProfileMetric[] = hasElevation
    ? ["speed", "elevation"]
    : ["speed"];
  const playback = useRidePlayback(profile, ride.segments);
  const playbackSample = useMemo(
    () =>
      playback.active ? profilePlaybackAt(profile, playback.position) : null,
    [profile, playback.active, playback.position],
  );
  const activeSample = useMemo(
    () => (cursor ? profileSampleAt(profile, cursor.position) : playbackSample),
    [profile, cursor?.position, playbackSample],
  );
  const activePosition =
    activeSample?.position ?? cursor?.position ?? playback.position;
  const lineX =
    cursor?.plotX ??
    (playback.active
      ? CHART.left + (playback.position / (profile.extent || 1)) * plotWidth
      : null);
  useEffect(() => {
    onPreview?.(
      activeSample
        ? {
            rideId: ride.id,
            lon: activeSample.coordinates[0],
            lat: activeSample.coordinates[1],
          }
        : null,
    );
  }, [onPreview, ride.id, activeSample]);
  useEffect(() => () => onPreview?.(null), [onPreview]);

  function previewAt(
    element: SVGSVGElement,
    position: number,
    metric: ProfileMetric,
  ) {
    const bounds = element.getBoundingClientRect();
    const plotX = CHART.left + (position / (profile.extent || 1)) * plotWidth;
    setCursor({
      position,
      metric,
      plotX,
      anchor: {
        x: bounds.left + (plotX / CHART.width) * bounds.width,
        y: bounds.top + bounds.height / 2,
      },
    });
  }

  function keyboard(
    event: KeyboardEvent<SVGSVGElement>,
    metric: ProfileMetric,
  ) {
    if (event.key === "Escape") {
      setCursor(null);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const samples = profile.samples;
    if (!samples.length) return;
    const current = activeSample ? samples.indexOf(activeSample) : 0;
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? samples.length - 1
          : Math.max(
              0,
              Math.min(
                samples.length - 1,
                current + (event.key === "ArrowRight" ? 1 : -1),
              ),
            );
    previewAt(event.currentTarget, samples[index].position, metric);
  }

  return (
    <div
      className="ride-charts"
      aria-label={hasElevation ? "骑行速度与海拔" : "骑行速度"}
    >
      <section className="ride-playback" aria-label="轨迹播放">
        <div className="ride-playback-heading">
          <h4>轨迹播放</h4>
          <div className="ride-playback-controls">
            <button
              type="button"
              disabled={!playback.enabled}
              aria-label={playback.playing ? "暂停轨迹播放" : "播放轨迹"}
              onClick={() => {
                setCursor(null);
                playback.toggle();
              }}
            >
              {playback.playing ? (
                <Pause size={14} aria-hidden="true" />
              ) : (
                <Play size={14} aria-hidden="true" />
              )}
              {playback.playing
                ? "暂停"
                : playback.active && playback.position >= profile.extent
                  ? "重播"
                  : "播放"}
            </button>
          </div>
        </div>
        <input
          className="ride-playback-progress"
          type="range"
          aria-label="轨迹播放进度"
          min={0}
          max={profile.extent}
          step={profile.axis === "time" ? 0.1 : 1}
          value={playback.position}
          disabled={!playback.enabled}
          aria-valuetext={`${Math.round((playback.position / (profile.extent || 1)) * 100)}%`}
          onChange={(event) => {
            setCursor(null);
            playback.seek(Number(event.currentTarget.value));
          }}
          onPointerDown={(event) => {
            setCursor(null);
            playback.beginScrub();
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerUp={() => playback.endScrub()}
          onPointerCancel={() => playback.endScrub(false)}
          onLostPointerCapture={() => playback.endScrub()}
          onBlur={() => playback.endScrub()}
        />
        {playback.active && (
          <div className="ride-playback-values">
            {playbackSample ? (
              <>
                <span>
                  {playbackSample.estimatedSpeed ? "估算速度" : "速度"}{" "}
                  <b>
                    {playbackSample.speed === null
                      ? "—"
                      : `${format(playbackSample.speed)} km/h`}
                  </b>
                </span>
                {hasElevation && (
                  <span>
                    海拔{" "}
                    <b>
                      {playbackSample.elevation === null
                        ? "—"
                        : `${format(playbackSample.elevation)} m`}
                    </b>
                  </span>
                )}
              </>
            ) : (
              <span>暂停或无采样数据</span>
            )}
          </div>
        )}
      </section>
      {metrics.map((metric) => {
        const speed = metric === "speed";
        const range = speed ? profile.speedRange : profile.elevationRange;
        const unit = speed ? "km/h" : "m";
        const scale = profileValueScale(range, metric);
        const plotY = (value: number) =>
          scale
            ? CHART.bottom -
              ((value - scale.min) / (scale.max - scale.min)) *
                (CHART.bottom - CHART.top)
            : CHART.bottom;
        const current = cursor?.metric === metric;
        const summary = speed ? profile.averageSpeed : profile.ascent;
        return (
          <section className={`ride-chart ride-chart-${metric}`} key={metric}>
            <div className="ride-chart-heading">
              <h4>{speed ? "速度" : "海拔高度"}</h4>
              {speed && profile.estimatedSpeed && (
                <span className="chart-estimate">含估算</span>
              )}
            </div>
            <div className="ride-chart-summary">
              <strong>
                {speed ? "平均值" : "累计爬升"}：
                {format(summary, speed ? 1 : 0)}
                {summary !== null && <small> {unit}</small>}
              </strong>
              <span>
                {range
                  ? `${format(range[0], speed ? 1 : 0)}–${format(range[1], speed ? 1 : 0)} ${unit}`
                  : "暂无数据"}
              </span>
            </div>
            <div className="ride-chart-plot">
              <div
                className="chart-y-axis"
                role="group"
                aria-label={`${speed ? "速度" : "海拔"}纵轴，单位 ${unit}`}
              >
                <span className="chart-axis-unit">{unit}</span>
                {scale?.ticks.map((tick) => (
                  <span
                    className="chart-y-tick"
                    key={tick}
                    style={{
                      top: `${(plotY(tick) / CHART.height) * 100}%`,
                      right: `${((CHART.width - CHART.left + 8) / CHART.width) * 100}%`,
                    }}
                  >
                    {format(tick, scale.digits)}
                  </span>
                ))}
              </div>
              <svg
                viewBox={`0 0 ${CHART.width} ${CHART.height}`}
                preserveAspectRatio="none"
                role="slider"
                tabIndex={profile.samples.length ? 0 : -1}
                aria-label={`${speed ? "速度" : "海拔高度"}图，左右方向键查看采样点`}
                aria-valuemin={0}
                aria-valuemax={profile.extent}
                aria-valuenow={cursor ? activePosition : 0}
                aria-valuetext={
                  cursor
                    ? `${profilePositionLabel(profile, activePosition)}，${activeSample?.[metric] != null ? `${format(activeSample[metric])} ${unit}` : "无采样数据"}`
                    : "鼠标悬停或使用方向键预览"
                }
                onPointerMove={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  if (!bounds.width || !profile.samples.length) return;
                  const plotX = Math.max(
                    0,
                    Math.min(
                      CHART.width,
                      ((event.clientX - bounds.left) / bounds.width) *
                        CHART.width,
                    ),
                  );
                  if (plotX < CHART.left) {
                    setCursor(null);
                    return;
                  }
                  const ratio = Math.max(
                    0,
                    Math.min(1, (plotX - CHART.left) / plotWidth),
                  );
                  setCursor({
                    position: ratio * profile.extent,
                    metric,
                    // Draw at the pointer, even between samples or in padding.
                    // Only the preview values snap to a real observation.
                    plotX,
                    anchor: { x: event.clientX, y: event.clientY },
                  });
                }}
                onPointerLeave={() => setCursor(null)}
                onFocus={(event) => {
                  const position = playback.active ? playback.position : 0;
                  previewAt(event.currentTarget, position, metric);
                }}
                onBlur={() => setCursor(null)}
                onKeyDown={(event) => keyboard(event, metric)}
              >
                <g aria-hidden="true">
                  {scale?.ticks.map((tick) => (
                    <line
                      key={tick}
                      className="chart-grid"
                      x1={CHART.left}
                      x2={CHART.right}
                      y1={plotY(tick)}
                      y2={plotY(tick)}
                    />
                  ))}
                  <line
                    className="chart-axis-line"
                    x1={CHART.left - 3}
                    x2={CHART.left - 3}
                    y1={CHART.top}
                    y2={CHART.bottom}
                  />
                </g>
                {bins.map((bin, i) => {
                  const value = bin[metric];
                  const x = CHART.left + ((i + 0.5) / bins.length) * plotWidth;
                  const height =
                    value === null ? 0 : CHART.bottom - plotY(value);
                  return height > 0 ? (
                    <line
                      key={i}
                      className="chart-bar"
                      x1={x}
                      x2={x}
                      y1={CHART.bottom - height}
                      y2={CHART.bottom}
                    />
                  ) : (
                    <circle
                      key={i}
                      className={
                        value === null ? "chart-missing" : "chart-zero"
                      }
                      cx={x}
                      cy={CHART.bottom}
                      r={1.25}
                    />
                  );
                })}
                {lineX !== null && (
                  <line
                    className="chart-cursor"
                    x1={lineX}
                    x2={lineX}
                    y1={CHART.top}
                    y2={CHART.bottom}
                  />
                )}
              </svg>
              {current && cursor && (
                <ChartTooltip anchor={cursor.anchor} metric={metric}>
                  <strong>
                    {profilePositionLabel(profile, activePosition)}
                  </strong>
                  {activeSample ? (
                    <>
                      <span>
                        {activeSample.estimatedSpeed ? "估算速度" : "速度"}
                        <b>
                          {activeSample.speed === null
                            ? "暂无数据"
                            : `${format(activeSample.speed)} km/h`}
                        </b>
                      </span>
                      {hasElevation && (
                        <span>
                          海拔
                          <b>
                            {activeSample.elevation === null
                              ? "暂无数据"
                              : `${format(activeSample.elevation)} m`}
                          </b>
                        </span>
                      )}
                    </>
                  ) : (
                    <span>无采样数据</span>
                  )}
                </ChartTooltip>
              )}
              {!range && (
                <p className="chart-empty">
                  {speed ? "暂无速度数据" : "暂无海拔数据"}
                </p>
              )}
            </div>
            <div
              className="ride-chart-axis"
              style={{
                paddingLeft: `${(CHART.left / CHART.width) * 100}%`,
                paddingRight: `${((CHART.width - CHART.right) / CHART.width) * 100}%`,
              }}
            >
              <span>{profilePositionLabel(profile, 0)}</span>
              <span>{profile.axis === "point" ? "轨迹点" : "经过时间"}</span>
              <span>{profilePositionLabel(profile, profile.extent)}</span>
            </div>
          </section>
        );
      })}
    </div>
  );
}
