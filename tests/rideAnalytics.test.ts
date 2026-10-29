import { expect, it } from "vitest";
import type { Ride } from "../src/types";
import { durationLabel, rideAnalytics } from "../src/rideAnalytics";

const now = new Date(2026, 9, 29, 12);
const date = (month: number, day: number, hour = 12) =>
  new Date(2026, month - 1, day, hour).toISOString();
const ride = (
  id: string,
  distance: number,
  duration: number | null = null,
  started: string | null = date(10, 29),
): Ride => ({
  id,
  name: id,
  distance,
  duration,
  date: started,
  segments: [],
  filename: `${id}.gpx`,
  importedAt: "",
});

it("uses only timed rides for weighted speed and time averages, retaining undated totals", () => {
  const rides = [
    ride("short", 10, 1800),
    ride("long", 20, 7200),
    ride("undated", 100, null, null),
  ];
  const before = structuredClone(rides);
  const data = rideAnalytics(rides, "all", now);
  expect(data.count).toBe(3);
  expect(data.distance).toBe(130);
  expect(data.duration).toBe(9000);
  expect(data.averageSpeed).toBe(12);
  expect(data.averageDuration).toBe(4500);
  expect(data.averageDistance).toBeCloseTo(130 / 3);
  expect(data.activeDays).toBe(1);
  expect(data.missingDate).toBe(1);
  expect(data.missingTime).toBe(1);
  expect(data.longest?.id).toBe("undated");
  expect(data.longestDuration?.id).toBe("long");
  expect(data.fastest?.id).toBe("short");
  expect(data.trend.reduce((sum, bucket) => sum + bucket.distance, 0)).toBe(30);
  expect(rides).toEqual(before);
});

it("filters a rolling 30 local calendar days inclusively and excludes future/unknown dates", () => {
  const rides = [
    ride("before", 1, null, date(9, 29, 23)),
    ride("first", 2, null, date(9, 30, 0)),
    ride("today", 4, null, date(10, 29, 23)),
    ride("future", 8, null, date(10, 30, 0)),
    ride("unknown", 16, null, null),
    ride("invalid", 32, null, "invalid date"),
  ];
  const data = rideAnalytics(rides, "month", now);
  expect(data.count).toBe(2);
  expect(data.distance).toBe(6);
  expect(data.missingDate).toBe(2);
  expect(data.trend).toHaveLength(30);
  expect(data.trend[0]).toMatchObject({ label: "9/30", distance: 2 });
  expect(data.trend.at(-1)).toMatchObject({ label: "10/29", distance: 4 });
  expect(data.trend[1].count).toBe(0);
});

it("uses local year boundaries and includes today through midnight", () => {
  const january = new Date(2026, 0, 1, 10);
  const rides = [
    ride("last-year", 1, null, new Date(2025, 11, 31, 23, 59).toISOString()),
    ride("new-year", 2, null, new Date(2026, 0, 1, 0).toISOString()),
    ride("late-today", 4, null, new Date(2026, 0, 1, 23).toISOString()),
    ride("tomorrow", 8, null, new Date(2026, 0, 2, 0).toISOString()),
  ];
  const data = rideAnalytics(rides, "year", january);
  expect(data.distance).toBe(6);
  expect(data.trend).toHaveLength(1);
  expect(data.trend[0].count).toBe(2);
});

it("counts same-day rides separately but calendar days once, with consecutive streaks", () => {
  const rides = [
    ride("mon", 1, null, date(10, 26)),
    ride("tue-am", 1, null, date(10, 27, 8)),
    ride("tue-pm", 1, null, date(10, 27, 18)),
    ride("wed", 1, null, date(10, 28)),
    ride("fri", 1, null, date(10, 30)),
  ];
  const data = rideAnalytics(rides.reverse(), "all", now);
  expect(data.activeDays).toBe(4);
  expect(data.longestStreak).toBe(3);
  expect(data.weekdays.map((day) => day.count)).toEqual([1, 2, 1, 0, 1, 0, 0]);
});

it("keeps consecutive local dates across daylight-saving boundaries", () => {
  const data = rideAnalytics(
    [7, 8, 9].map((day) => ride(String(day), 1, null, date(3, day))),
    "all",
    now,
  );
  expect(data.longestStreak).toBe(3);
});

it("preserves every month in a bounded grouped trend across many years", () => {
  const rides = [
    ride("old", 10, null, new Date(2020, 0, 1).toISOString()),
    ride("new", 20),
  ];
  const data = rideAnalytics(rides, "all", now);
  expect(data.trend.length).toBeLessThanOrEqual(12);
  expect(data.trend[0].distance).toBe(10);
  expect(data.trend.at(-1)?.distance).toBe(20);
  expect(
    data.trend.filter((bucket) => bucket.count === 0).length,
  ).toBeGreaterThan(0);
  expect(data.trend.reduce((sum, bucket) => sum + bucket.distance, 0)).toBe(30);
});

it("places exact distance thresholds in one non-overlapping bucket", () => {
  const data = rideAnalytics(
    [0, 9.99, 10, 29.99, 30, 49.99, 50, 100].map((km, i) =>
      ride(String(i), km),
    ),
    "all",
    now,
  );
  expect(data.distribution.map((bin) => bin.count)).toEqual([2, 2, 2, 2]);
});

it("distinguishes missing values from genuine zero distance and empty periods", () => {
  const missing = rideAnalytics([ride("missing", 5, null, null)], "all", now);
  expect(missing.duration).toBeNull();
  expect(missing.averageSpeed).toBeNull();
  expect(missing.activeDays).toBeNull();
  expect(missing.longestStreak).toBeNull();
  expect(missing.trend).toEqual([]);
  const zero = rideAnalytics([ride("stationary", 0, 60)], "all", now);
  expect(zero.averageSpeed).toBe(0);
  expect(zero.fastest?.id).toBe("stationary");
  const empty = rideAnalytics([], "month", now);
  expect(empty.count).toBe(0);
  expect(empty.activeDays).toBe(0);
  expect(empty.averageDistance).toBeNull();
  expect(empty.longest).toBeNull();
});

it("rejects nonpositive or nonfinite legacy durations in derived speed statistics", () => {
  const data = rideAnalytics(
    [0, -1, NaN, Infinity].map((duration, i) => ride(String(i), 10, duration)),
    "all",
    now,
  );
  expect(data.duration).toBeNull();
  expect(data.averageSpeed).toBeNull();
  expect(data.fastest).toBeNull();
  expect(data.missingTime).toBe(4);
});

it("formats elapsed durations consistently in hours and minutes", () => {
  expect(durationLabel(null)).toBe("暂无数据");
  expect(durationLabel(0)).toBe("0min");
  expect(durationLabel(3599)).toBe("59min");
  expect(durationLabel(3600)).toBe("1h 0min");
  expect(durationLabel(8130)).toBe("2h 15min");
});
