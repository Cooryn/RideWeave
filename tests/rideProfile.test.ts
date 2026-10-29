import { expect, it } from "vitest";
import type { Point, Ride } from "../src/types";
import {
  profileBins,
  profilePositionLabel,
  profileSampleAt,
  profileValueScale,
  rideProfile,
  profilePlaybackAt,
  advancePlaybackPosition,
} from "../src/rideProfile";
const point = (
  seconds: number,
  elevation: number | null = 10,
  speed?: number | null,
): Point => ({
  lat: 0,
  lon: seconds / 100000,
  time: new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString(),
  elevation,
  speed,
});
const ride = (segments: Point[][]): Ride => ({
  id: "test",
  name: "test",
  date: null,
  distance: 1,
  duration: 100,
  segments,
  filename: "test.gpx",
  importedAt: "",
});

it("encloses speed and elevation ranges with distinct finite value-axis ticks", () => {
  for (const [range, metric] of [
    [[0, 31.5], "speed"],
    [[0, 0], "speed"],
    [[4, 21], "elevation"],
    [[12.5, 12.5], "elevation"],
    [[-12, -6], "elevation"],
    [[12.3, 12.8], "elevation"],
  ] as const) {
    const original: [number, number] = [...range];
    const scale = profileValueScale(original, metric)!;
    expect(scale.min).toBeLessThanOrEqual(range[0]);
    expect(scale.max).toBeGreaterThanOrEqual(range[1]);
    expect(scale.max).toBeGreaterThan(scale.min);
    expect(scale.ticks.every(Number.isFinite)).toBe(true);
    expect(scale.ticks.length).toBeGreaterThanOrEqual(2);
    expect(scale.ticks.length).toBeLessThanOrEqual(5);
    expect(new Set(scale.ticks.map((t) => t.toFixed(scale.digits))).size).toBe(
      scale.ticks.length,
    );
    if (metric === "speed") expect(scale.min).toBe(0);
    expect(original).toEqual(range);
  }
  expect(profileValueScale([0, 31.5], "speed")?.max).toBe(35);
  expect(profileValueScale([4, 21], "elevation")?.max).toBe(22);
  expect(profileValueScale([0, 100], "speed")!.max).toBeGreaterThan(100);
  expect(profileValueScale(null, "speed")).toBeNull();
});

it("prefers recorded speeds, preserves genuine zeros and estimates only continuous observations", () => {
  const trace = ride([
    [point(0, 5, 0), point(1, 6, 5), point(2, 7), point(100, 20)],
    [point(101, 20)],
  ]);
  const before = JSON.stringify(trace);
  const p = rideProfile(trace);
  expect(p.samples[0].speed).toBe(0);
  expect(p.samples[1].speed).toBe(18);
  expect(p.samples[1].estimatedSpeed).toBe(false);
  expect(p.samples[2].speed).toBeCloseTo(4.003, 2);
  expect(p.samples[2].estimatedSpeed).toBe(true);
  expect(p.samples.slice(3).map((s) => s.speed)).toEqual([null, null]);
  expect(p.averageSpeed).toBe(36);
  expect(JSON.stringify(trace)).toBe(before);
});

it("smoothly replays observed geometry without changing the original samples", () => {
  const trace = ride([[point(0, 10, 5), point(10, 20, 6), point(20, 15, 4)]]);
  const before = JSON.stringify(trace);
  const p = rideProfile(trace);
  const frame = profilePlaybackAt(p, 5)!;
  expect(frame.position).toBe(5);
  expect(frame.coordinates[0]).toBeCloseTo(0.00005);
  expect(frame.coordinates[1]).toBe(0);
  expect(profilePlaybackAt(p, 20)?.coordinates).toEqual([0.0002, 0]);
  expect(advancePlaybackPosition(p, 19, 20)).toBe(20);
  expect(JSON.stringify(trace)).toBe(before);
});

it("skips playback gaps while a deliberate seek into a gap remains unknown", () => {
  const p = rideProfile(ride([[point(0), point(1), point(120), point(121)]]));
  expect(profilePlaybackAt(p, 60)).toBeNull();
  expect(advancePlaybackPosition(p, 1, 1)).toBe(120);
  expect(advancePlaybackPosition(p, 60, 0.05)).toBe(120);
  expect(profilePlaybackAt(p, 120)?.coordinates).toEqual([0.0012, 0]);
  const split = rideProfile(
    ride([
      [point(0), point(1)],
      [point(2), point(3)],
    ]),
  );
  expect(profilePlaybackAt(split, 1.5)).toBeNull();
});

it("supports point-order playback without inventing timestamps", () => {
  const p = rideProfile(
    ride([
      [
        { ...point(0), time: null },
        { ...point(10), time: null },
        { ...point(20), time: null },
      ],
    ]),
  );
  expect(p.axis).toBe("point");
  expect(profilePlaybackAt(p, 0.5)?.coordinates[0]).toBeCloseTo(0.00005);
  expect(advancePlaybackPosition(p, 1, 10)).toBe(2);
});

it("leaves time gaps empty in bars and hover lookup instead of extending the endpoints", () => {
  const p = rideProfile(
    ride([
      [point(0, 1, 2), point(1, 2, 3), point(120, 12, 4), point(121, 13, 5)],
    ]),
  );
  expect(p.axis).toBe("time");
  expect(p.extent).toBe(121);
  const bins = profileBins(p, 4);
  expect(bins.slice(1, 3).map((b) => [b.speed, b.elevation])).toEqual([
    [null, null],
    [null, null],
  ]);
  expect(profileSampleAt(p, 60)).toBeNull();
  expect(profileSampleAt(p, 1)?.speed).toBeCloseTo(10.8);
  expect(profilePositionLabel(p, 120)).toBe("0:02:00");
});

it("uses point order for incomplete or reversed clocks and retains negative elevations", () => {
  for (const segment of [
    [point(1), { ...point(2), time: null }],
    [point(2), point(1)],
  ]) {
    const p = rideProfile(ride([segment]));
    expect(p.axis).toBe("point");
    expect(p.samples.every((s) => s.speed === null)).toBe(true);
    expect(profilePositionLabel(p, 1)).toBe("第 2 点");
  }
  const p = rideProfile(ride([[point(0, -12, 0), point(1, -6, 0)]]));
  expect(p.elevationRange).toEqual([-12, -6]);
  expect(p.speedRange).toEqual([0, 0]);
});

it("suppresses elevation noise and counts sustained climbs without spanning missing heights or pauses", () => {
  const noisy = rideProfile(
    ride([[10, 10.5, 9.8, 11, 10, 10.5].map((h, i) => point(i, h))]),
  );
  expect(noisy.ascent).toBe(0);
  const climbing = rideProfile(
    ride([
      [0, 3, 6, 9].map((h, i) => point(i, h)),
      [100, 103, 106].map((h, i) => point(100 + i, h)),
      [point(200, null), point(201, 500)],
    ]),
  );
  expect(climbing.ascent).toBe(15);
  expect(
    rideProfile(ride([[point(0, null), point(1, null)]])).ascent,
  ).toBeNull();
});

it("bounds chart size while retaining raw sample ranges and keeps absent metrics distinct from zero", () => {
  const p = rideProfile(
    ride([
      Array.from({ length: 1000 }, (_, i) =>
        point(i, i % 100, i === 500 ? 50 : 5),
      ),
    ]),
  );
  expect(profileBins(p)).toHaveLength(72);
  expect(p.speedRange).toEqual([18, 180]);
  expect(p.samples).toHaveLength(1000);
  const absent = rideProfile(
    ride([
      [
        { ...point(0, null), time: null },
        { ...point(1, null), time: null },
      ],
    ]),
  );
  expect(absent.speedRange).toBeNull();
  expect(absent.elevationRange).toBeNull();
  expect(
    profileBins(absent).every((b) => b.speed === null && b.elevation === null),
  ).toBe(true);
  expect(profileSampleAt(rideProfile(ride([])), 0)).toBeNull();
});
