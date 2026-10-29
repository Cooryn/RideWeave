import type { Point, Ride } from "./types";
import { distanceBetween } from "./gpx";

export type ProfileSample = {
  coordinates: [number, number];
  position: number;
  speed: number | null;
  elevation: number | null;
  estimatedSpeed: boolean;
  run: number;
};
export type RideProfile = {
  samples: ProfileSample[];
  axis: "time" | "point";
  extent: number;
  averageSpeed: number | null;
  speedRange: [number, number] | null;
  elevationRange: [number, number] | null;
  ascent: number | null;
  estimatedSpeed: boolean;
};
export type ProfileMetric = "speed" | "elevation";

/** Tight adaptive limits enclose raw peaks, with 5% headroom and readable labels. */
export function profileValueScale(
  range: [number, number] | null,
  metric: ProfileMetric,
) {
  if (!range) return null;
  let min = metric === "speed" ? 0 : range[0],
    max = range[1];
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null;
  if (min === max) {
    if (metric === "speed") max = Math.max(1, max);
    else {
      const padding = Math.max(1, Math.abs(min) * 0.01);
      min -= padding;
      max += padding;
    }
  }
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return null;
  const exponent = Math.floor(Math.log10(span / 10));
  const magnitude = 10 ** exponent;
  const factor = [1, 2, 2.5, 5, 10].find((n) => n * magnitude >= span / 10)!;
  const step = factor * magnitude;
  if (!Number.isFinite(step) || step <= 0) return null;
  const lower = Math.floor(min / step) * step;
  const upper = Math.ceil((max + span * 0.05) / step) * step;
  if (!Number.isFinite(upper - lower) || upper <= lower) return null;
  // Three evenly spaced labels remain legible in the narrow detail panel.
  const ticks = [lower, lower + (upper - lower) / 2, upper].map((n) =>
    Number(n.toPrecision(12)),
  );
  let digits = 0;
  while (
    digits < 6 &&
    ticks.some(
      (n) =>
        Math.abs(n - Number(n.toFixed(digits))) >
        Math.max(1, Math.abs(n)) * 1e-10,
    )
  )
    digits++;
  return {
    min: lower,
    max: upper,
    ticks,
    digits,
  };
}
const finite = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n);
const timestamp = (p: Point) => (p.time ? Date.parse(p.time) / 1000 : NaN);
const valid = (p: Point) =>
  Number.isFinite(p.lat + p.lon) &&
  Math.abs(p.lat) <= 90 &&
  Math.abs(p.lon) <= 180;

function range(
  samples: ProfileSample[],
  metric: ProfileMetric,
): [number, number] | null {
  let min = Infinity,
    max = -Infinity;
  for (const sample of samples) {
    const n = sample[metric];
    if (n !== null) {
      min = Math.min(min, n);
      max = Math.max(max, n);
    }
  }
  return min === Infinity ? null : [min, max];
}

// Three-sample median filtering and a 3 m rise threshold suppress small GPS
// oscillations. Missing heights and sampling/segment breaks reset the baseline.
function cumulativeAscent(samples: ProfileSample[]): number | null {
  let ascent = 0,
    pairs = 0,
    baseline: number | null = null,
    previousRun = -1;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (sample.elevation === null) {
      baseline = null;
      continue;
    }
    const previous = samples[i - 1],
      next = samples[i + 1];
    const window =
      previous?.run === sample.run &&
      next?.run === sample.run &&
      previous.elevation !== null &&
      next.elevation !== null
        ? [previous.elevation, sample.elevation, next.elevation]
        : [sample.elevation];
    window.sort((a, b) => a - b);
    const middle =
      (window[Math.floor((window.length - 1) / 2)] +
        window[Math.floor(window.length / 2)]) /
      2;
    if (baseline === null || previousRun !== sample.run) baseline = middle;
    else {
      pairs++;
      if (middle < baseline) baseline = middle;
      else if (middle - baseline >= 3) {
        ascent += middle - baseline;
        baseline = middle;
      }
    }
    previousRun = sample.run;
  }
  return pairs ? ascent : null;
}

export function rideProfile(ride: Ride): RideProfile {
  const samples: ProfileSample[] = [],
    times: number[] = [];
  let run = 0;
  for (const segment of ride.segments) {
    let previous: Point | undefined;
    run++;
    for (const p of segment) {
      if (!valid(p)) {
        previous = undefined;
        run++;
        continue;
      }
      const t = timestamp(p);
      const dt = previous ? t - timestamp(previous) : NaN;
      const distance = previous ? distanceBetween(previous, p) : 0;
      const discontinuous =
        !previous ||
        distance > 0.3 ||
        (Number.isFinite(dt) && (dt <= 0 || dt >= 30));
      if (discontinuous) run++;
      let speed =
        finite(p.speed) && p.speed >= 0 && Number.isFinite(p.speed * 3.6)
          ? p.speed * 3.6
          : null;
      let estimatedSpeed = false;
      if (speed === null && !discontinuous && Number.isFinite(dt) && dt > 0) {
        speed = (distance / dt) * 3600;
        estimatedSpeed = true;
      }
      samples.push({
        coordinates: [p.lon, p.lat],
        position: samples.length,
        speed,
        elevation: finite(p.elevation) ? p.elevation : null,
        estimatedSpeed,
        run,
      });
      times.push(t);
      previous = p;
    }
  }
  const timed =
    times.length > 1 &&
    times.at(-1)! > times[0] &&
    times.every((t, i) => Number.isFinite(t) && (!i || t >= times[i - 1]));
  if (timed)
    samples.forEach((s, i) => {
      s.position = times[i] - times[0];
    });
  return {
    samples,
    axis: timed ? "time" : "point",
    extent: samples.at(-1)?.position ?? 0,
    averageSpeed:
      ride.duration !== null && ride.duration > 0
        ? (ride.distance / ride.duration) * 3600
        : null,
    speedRange: range(samples, "speed"),
    elevationRange: range(samples, "elevation"),
    ascent: cumulativeAscent(samples),
    estimatedSpeed: samples.some((s) => s.estimatedSpeed),
  };
}

export function profileBins(profile: RideProfile, limit = 72) {
  const count = Math.min(limit, Math.max(1, profile.samples.length));
  const bins = Array.from({ length: count }, (_, i) => ({
    position: ((i + 0.5) / count) * profile.extent,
    speed: null as number | null,
    elevation: null as number | null,
    speeds: 0,
    heights: 0,
  }));
  for (const sample of profile.samples) {
    const bin =
      bins[
        Math.min(
          count - 1,
          Math.floor((sample.position / (profile.extent || 1)) * count),
        )
      ];
    if (sample.speed !== null) {
      bin.speed = (bin.speed ?? 0) + sample.speed;
      bin.speeds++;
    }
    if (sample.elevation !== null) {
      bin.elevation = (bin.elevation ?? 0) + sample.elevation;
      bin.heights++;
    }
  }
  return bins.map((b) => ({
    position: b.position,
    speed: b.speeds ? b.speed! / b.speeds : null,
    elevation: b.heights ? b.elevation! / b.heights : null,
  }));
}

function samplesAround(profile: RideProfile, position: number) {
  const samples = profile.samples;
  if (!samples.length) return null;
  let lo = 0,
    hi = samples.length - 1;
  while (lo < hi) {
    const middle = (lo + hi) >>> 1;
    if (samples[middle].position < position) lo = middle + 1;
    else hi = middle;
  }
  return { next: samples[lo], previous: samples[Math.max(0, lo - 1)] };
}

/** Locate a real sample; never fill a sampling pause with an endpoint value. */
export function profileSampleAt(
  profile: RideProfile,
  position: number,
): ProfileSample | null {
  const neighbors = samplesAround(profile, position);
  if (!neighbors) return null;
  const { next, previous } = neighbors;
  if (
    profile.axis === "time" &&
    next.run !== previous.run &&
    position > previous.position + 0.5 &&
    position < next.position - 0.5
  )
    return null;
  return Math.abs(previous.position - position) <
    Math.abs(next.position - position)
    ? previous
    : next;
}

/** Interpolate only the position on an observed GPX segment, never through gaps. */
export function profilePlaybackAt(
  profile: RideProfile,
  position: number,
): ProfileSample | null {
  const neighbors = samplesAround(profile, position);
  if (!neighbors) return null;
  const { previous, next } = neighbors;
  if (position <= previous.position) return previous;
  if (position >= next.position) return next;
  if (previous.run !== next.run) return null;
  const t =
    (position - previous.position) / (next.position - previous.position);
  let longitude = next.coordinates[0] - previous.coordinates[0];
  if (Math.abs(longitude) > 180) longitude -= Math.sign(longitude) * 360;
  let lon = previous.coordinates[0] + longitude * t;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return {
    ...(t < 0.5 ? previous : next),
    position,
    coordinates: [
      lon,
      previous.coordinates[1] +
        (next.coordinates[1] - previous.coordinates[1]) * t,
    ],
  };
}

export function advancePlaybackPosition(
  profile: RideProfile,
  position: number,
  delta: number,
) {
  const target = Math.max(
    0,
    Math.min(profile.extent, position + Math.max(0, delta)),
  );
  const neighbors = samplesAround(profile, target);
  if (
    neighbors &&
    neighbors.previous.run !== neighbors.next.run &&
    target > neighbors.previous.position &&
    target < neighbors.next.position
  )
    return neighbors.next.position;
  return target;
}

export function profilePositionLabel(profile: RideProfile, position: number) {
  if (profile.axis === "point") return `第 ${Math.round(position) + 1} 点`;
  const seconds = Math.max(0, Math.floor(position));
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
