import { expect, it } from "vitest";
import { trackContinuity } from "../src/trackGaps";
import type { Point } from "../src/types";

const p = (x: number, t: number | null): Point => ({
  lon: x / 111195,
  lat: 0,
  elevation: null,
  time:
    t === null
      ? null
      : new Date(Date.UTC(2026, 9, 29) + t * 1000).toISOString(),
});
it("recognizes timed segment pauses and in-segment recording pauses without changing GPX points", () => {
  const parts = [
    [p(0, 0), p(40, 10), p(80, 20)],
    [p(160, 120), p(200, 130), p(240, 140)],
  ];
  const before = JSON.stringify(parts);
  expect(trackContinuity(parts).gaps).toHaveLength(1);
  expect(trackContinuity([parts.flat()]).gaps).toHaveLength(1);
  expect(JSON.stringify(parts)).toBe(before);
  expect(trackContinuity([[p(0, 0), p(80, 120)]]).chunks).toHaveLength(1);
});
it("rejects unsupported long, reversed, implausibly fast and long-separated gaps", () => {
  for (const [x, t] of [
    [900, 120],
    [160, 10],
    [160, 21],
    [160, 8000],
  ]) {
    expect(
      trackContinuity([
        [p(0, 0), p(80, 20)],
        [p(x, t), p(x + 40, t + 10)],
      ]).gaps,
    ).toEqual([]);
  }
});

const movingPause = (metres = 1680, seconds = 1270) => [
  Array.from({ length: 16 }, (_, i) => p(i * 6, i)),
  Array.from({ length: 16 }, (_, i) =>
    p(90 + metres + i * 3, 15 + seconds + i),
  ),
];
it("allows a long timed pause with sustained movement on both sides, within a single segment too", () => {
  const parts = movingPause();
  const before = JSON.stringify(parts);
  expect(trackContinuity(parts).gaps).toHaveLength(1);
  expect(trackContinuity([parts.flat()]).gaps).toHaveLength(1);
  expect(JSON.stringify(parts)).toBe(before);
});
it("rejects a startup location jump even when its distance and elapsed time would allow a pause", () => {
  const parts = movingPause(880, 410);
  parts[0] = Array.from({ length: 8 }, (_, i) => p(90 - (7 - i) * 0.02, 8 + i));
  expect(trackContinuity(parts).chunks).toHaveLength(2);
  expect(trackContinuity(parts).gaps).toEqual([]);
});
it("bounds long pauses by distance, time, speed and directional movement rather than GPS jitter", () => {
  for (const [metres, seconds] of [
    [2100, 1270],
    [510, 59],
    [700, 60],
    [1680, 8000],
  ])
    expect(trackContinuity(movingPause(metres, seconds)).gaps).toEqual([]);
  const shortContext = movingPause();
  shortContext[1] = shortContext[1].slice(0, 3);
  expect(trackContinuity(shortContext).gaps).toEqual([]);
  const jitter = movingPause();
  jitter[0] = Array.from({ length: 16 }, (_, i) => p(i % 2 ? 90 : 110, i));
  expect(trackContinuity(jitter).gaps).toEqual([]);
  const unknown = movingPause().map((line) =>
    line.map((point) => ({ ...point, time: null })),
  );
  expect(trackContinuity(unknown).gaps).toEqual([]);
});
it("keeps a stationary pause continuous without creating an inferred excursion", () => {
  const points = [p(0, 0), p(5, 1), p(11, 274), p(16, 275)];
  expect(trackContinuity([points]).chunks).toHaveLength(1);
  expect(trackContinuity([points]).gaps).toEqual([]);
});
it("allows only nearby unknown-time endpoints and never skips invalid points or singleton segments", () => {
  expect(
    trackContinuity([
      [p(0, null), p(40, null)],
      [p(60, null), p(100, null)],
    ]).gaps,
  ).toHaveLength(1);
  expect(
    trackContinuity([
      [p(0, null), p(40, null)],
      [p(100, null), p(140, null)],
    ]).gaps,
  ).toEqual([]);
  expect(
    trackContinuity([
      [p(0, 0), p(40, 10)],
      [p(50, 20)],
      [p(60, 30), p(100, 40)],
    ]).gaps,
  ).toEqual([]);
  expect(
    trackContinuity([
      [p(0, 0), p(40, 10), { ...p(50, 20), lon: NaN }, p(60, 30), p(100, 40)],
    ]).gaps,
  ).toEqual([]);
});
