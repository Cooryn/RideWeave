import type { Ride } from "./types";

export type StatsPeriod = "month" | "year" | "all";
type Bucket = {
  key: string;
  label: string;
  detail: string;
  distance: number;
  count: number;
};
const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const dayKey = (d: Date) =>
  `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();
const monthLabel = (index: number) =>
  `${Math.floor(index / 12)}/${(((index % 12) + 12) % 12) + 1}`;
// Calendar ordinals avoid treating the 23/25-hour daylight-saving days as gaps.
const dayIndex = (d: Date) => {
  const day = new Date(0);
  day.setUTCFullYear(d.getFullYear(), d.getMonth(), d.getDate());
  return day.getTime() / 86400000;
};
const rideDate = (ride: Ride) => {
  const date = ride.date ? new Date(ride.date) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
};
const timed = (ride: Ride) =>
  ride.duration !== null && Number.isFinite(ride.duration) && ride.duration > 0;

export function rideAnalytics(
  rides: Ride[],
  period: StatsPeriod,
  now = new Date(),
) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(today);
  end.setDate(end.getDate() + 1);
  const start = new Date(today);
  if (period === "month") start.setDate(start.getDate() - 29);
  else if (period === "year") start.setMonth(0, 1);

  const entries = rides.map((ride) => ({ ride, date: rideDate(ride) }));
  const selected = entries.filter(
    ({ date }) => period === "all" || (date && date >= start && date < end),
  );
  const dated = selected.filter(
    (entry): entry is { ride: Ride; date: Date } => entry.date !== null,
  );
  const knownTime = selected.filter(({ ride }) => timed(ride));
  const distance = selected.reduce((sum, { ride }) => sum + ride.distance, 0);
  const duration = knownTime.length
    ? knownTime.reduce((sum, { ride }) => sum + ride.duration!, 0)
    : null;
  const timedDistance = knownTime.reduce(
    (sum, { ride }) => sum + ride.distance,
    0,
  );
  const days = [...new Set(dated.map(({ date }) => dayIndex(date)))].sort(
    (a, b) => a - b,
  );
  let streak = 0,
    longestStreak = 0;
  days.forEach((day, i) => {
    streak = i && day === days[i - 1] + 1 ? streak + 1 : 1;
    longestStreak = Math.max(longestStreak, streak);
  });

  const weekdayCounts = weekdays.map((label) => ({ label, count: 0 }));
  dated.forEach(({ date }) => weekdayCounts[(date.getDay() + 6) % 7].count++);
  const distribution = [
    { label: "不足 10 km", min: 0, max: 10, count: 0 },
    { label: "10–30 km", min: 10, max: 30, count: 0 },
    { label: "30–50 km", min: 30, max: 50, count: 0 },
    { label: "50 km 及以上", min: 50, max: Infinity, count: 0 },
  ];
  selected.forEach(({ ride }) => {
    const bin = distribution.find(
      ({ min, max }) => ride.distance >= min && ride.distance < max,
    );
    if (bin) bin.count++;
  });

  const trend: Bucket[] = [];
  if (period === "month") {
    for (let i = 0; i < 30; i++) {
      const date = new Date(start);
      date.setDate(date.getDate() + i);
      trend.push({
        key: dayKey(date),
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        detail: date.toLocaleDateString("zh-CN"),
        distance: 0,
        count: 0,
      });
    }
    const buckets = new Map(trend.map((bucket) => [bucket.key, bucket]));
    dated.forEach(({ ride, date }) => {
      const bucket = buckets.get(dayKey(date))!;
      bucket.distance += ride.distance;
      bucket.count++;
    });
  } else if (dated.length || period === "year") {
    let first = monthIndex(today),
      last = first;
    if (period === "year") first = now.getFullYear() * 12;
    else {
      first = Infinity;
      last = -Infinity;
      dated.forEach(({ date }) => {
        first = Math.min(first, monthIndex(date));
        last = Math.max(last, monthIndex(date));
      });
    }
    const step = Math.max(1, Math.ceil((last - first + 1) / 12));
    for (let month = first; month <= last; month += step) {
      const finish = Math.min(last, month + step - 1);
      trend.push({
        key: String(month),
        label: monthLabel(month),
        detail:
          month === finish
            ? monthLabel(month)
            : `${monthLabel(month)} – ${monthLabel(finish)}`,
        distance: 0,
        count: 0,
      });
    }
    dated.forEach(({ ride, date }) => {
      const bucket = trend[Math.floor((monthIndex(date) - first) / step)];
      bucket.distance += ride.distance;
      bucket.count++;
    });
  }
  function best(
    candidates: typeof selected,
    value: (ride: Ride) => number,
  ): Ride | null {
    return candidates.reduce<Ride | null>(
      (winner, { ride }) =>
        !winner || value(ride) > value(winner) ? ride : winner,
      null,
    );
  }
  return {
    count: selected.length,
    distance,
    duration,
    timedCount: knownTime.length,
    missingTime: selected.length - knownTime.length,
    missingDate: entries.filter(({ date }) => !date).length,
    datedCount: dated.length,
    activeDays: dated.length ? days.length : selected.length ? null : 0,
    longestStreak: dated.length ? longestStreak : selected.length ? null : 0,
    averageDistance: selected.length ? distance / selected.length : null,
    averageDuration: duration === null ? null : duration / knownTime.length,
    averageSpeed: duration ? (timedDistance / duration) * 3600 : null,
    weekdays: weekdayCounts,
    distribution,
    trend,
    longest: best(selected, (ride) => ride.distance),
    longestDuration: best(knownTime, (ride) => ride.duration!),
    fastest: best(knownTime, (ride) => ride.distance / ride.duration!),
  };
}

export function durationLabel(seconds: number | null) {
  if (seconds === null) return "暂无数据";
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}min`
    : `${minutes}min`;
}
