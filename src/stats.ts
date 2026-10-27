import type { Ride } from "./types";
export function stats(rides: Ride[], now = new Date()) {
  return {
    count: rides.length,
    distance: rides.reduce((s, r) => s + r.distance, 0),
    duration: rides.some((r) => r.duration !== null)
      ? rides.reduce((s, r) => s + (r.duration ?? 0), 0)
      : null,
    missingTime: rides.filter((r) => r.duration === null).length,
    longest: rides.length ? Math.max(...rides.map((r) => r.distance)) : null,
    month: rides
      .filter((r) => {
        const d = r.date ? new Date(r.date) : null;
        return (
          d &&
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth()
        );
      })
      .reduce((s, r) => s + r.distance, 0),
  };
}
export const number = (n: number | null, digits = 1) =>
  n === null
    ? "暂无数据"
    : n.toLocaleString("zh-CN", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
export const dateLabel = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "日期暂无数据";
