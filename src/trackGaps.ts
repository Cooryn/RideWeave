import type { Point } from "./types";
import { distanceBetween } from "./gpx";

export const SHORT_PAUSE_DISTANCE = 500;
export const MAX_PAUSE_DISTANCE = 2000;
export const pauseCorridor = (distance: number) =>
  Math.max(
    45,
    Math.min(distance > SHORT_PAUSE_DISTANCE ? 450 : 150, distance * 0.6),
  );
export const pauseSpeedLimit = (distance: number) =>
  (distance > SHORT_PAUSE_DISTANCE ? 35 : 60) / 3.6;
const MAX_PAUSE_SECONDS = 2 * 60 * 60;
const valid = (p: Point) =>
  Number.isFinite(p.lon + p.lat) &&
  Math.abs(p.lon) <= 180 &&
  Math.abs(p.lat) <= 90;
const seconds = (a: Point, b: Point) =>
  a.time && b.time ? (Date.parse(b.time) - Date.parse(a.time)) / 1000 : null;

export type TrackGap = {
  before: Point[];
  after: Point[];
  distance: number;
  seconds: number | null;
};

// Long pauses need actual movement on both sides. A handful of nearly
// identical startup fixes must not become a kilometre-long inferred journey.
function movingContext(points: Point[], end: boolean) {
  const ordered = end ? points.slice(-40).reverse() : points.slice(0, 40);
  const boundary = ordered[0]?.time ? Date.parse(ordered[0].time) : NaN;
  if (!Number.isFinite(boundary)) return false;
  const context: Point[] = [];
  let elapsed = 0,
    path = 0;
  for (const p of ordered) {
    if (!p.time) return false;
    const offset = ((Date.parse(p.time) - boundary) / 1000) * (end ? -1 : 1);
    if (!Number.isFinite(offset) || offset < elapsed) return false;
    if (offset > 30) break;
    if (context.length) path += distanceBetween(context.at(-1)!, p) * 1000;
    context.push(p);
    elapsed = offset;
  }
  if (context.length < 4 || elapsed < 5) return false;
  const displacement = distanceBetween(context[0], context.at(-1)!) * 1000;
  return displacement >= 10 && displacement >= path * 0.6;
}
export function trackContinuity(segments: Point[][]) {
  const chunks: Point[][] = [],
    gaps: TrackGap[] = [];
  let previous: Point[] | undefined;
  const finish = (points: Point[]) => {
    if (points.length < 2) {
      previous = undefined;
      return;
    }
    chunks.push(points);
    if (previous) {
      const a = previous.at(-1)!,
        b = points[0],
        distance = distanceBetween(a, b) * 1000,
        elapsed = seconds(a, b);
      const timeKnown = a.time !== null || b.time !== null;
      const plausible = timeKnown
        ? elapsed !== null &&
          Number.isFinite(elapsed) &&
          elapsed > 0 &&
          elapsed <= MAX_PAUSE_SECONDS &&
          distance / elapsed <= pauseSpeedLimit(distance)
        : distance <= 30;
      if (
        distance <= MAX_PAUSE_DISTANCE &&
        Math.abs(a.lon - b.lon) <= 180 &&
        plausible &&
        (distance <= SHORT_PAUSE_DISTANCE ||
          (elapsed !== null &&
            elapsed >= 60 &&
            movingContext(previous, true) &&
            movingContext(points, false)))
      )
        gaps.push({
          before: previous,
          after: points,
          distance,
          seconds: elapsed,
        });
    }
    previous = points;
  };
  for (const segment of segments) {
    if (!segment.length) continue;
    let points: Point[] = [];
    for (let i = 0; i < segment.length; i++) {
      const p = segment[i];
      if (!valid(p)) {
        finish(points);
        points = [];
        previous = undefined;
        continue;
      }
      const last = points.at(-1);
      if (last) {
        const distance = distanceBetween(last, p) * 1000,
          elapsed = seconds(last, p);
        // A long sampling pause can also occur inside a single trkseg. Require
        // observations on both sides rather than discarding a two-point track.
        if (
          distance > 300 ||
          (points.length >= 2 &&
            segment.length - i >= 2 &&
            elapsed !== null &&
            elapsed >= 30 &&
            distance >= 15)
        ) {
          finish(points);
          points = [];
        }
      }
      points.push(p);
    }
    finish(points);
  }
  return { chunks, gaps };
}
