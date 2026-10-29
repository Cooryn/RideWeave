import type { Point, Ride } from "./types";
const children = (el: Element, name: string) =>
  Array.from(el.children).filter((e) => e.localName === name);
const value = (el: Element, name: string) =>
  children(el, name)[0]?.textContent?.trim() || null;
export function distanceBetween(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function recordedSpeed(el: Element): number | null {
  const extension = children(el, "extensions")[0];
  const text =
    value(el, "speed") ??
    Array.from(extension?.getElementsByTagName("*") ?? [])
      .find((e) => e.localName === "speed")
      ?.textContent?.trim();
  const speed = text ? Number(text) : NaN;
  return Number.isFinite(speed) && speed >= 0 ? speed : null;
}

function readGpx(raw: string) {
  if (/<!DOCTYPE/i.test(raw)) throw new Error("不支持含 DOCTYPE 的 GPX");
  const doc = new DOMParser().parseFromString(raw, "application/xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.localName !== "gpx"
  )
    throw new Error("GPX 格式无效");
  const segments: Point[][] = [];
  const tracks = children(doc.documentElement, "trk");
  const routes = children(doc.documentElement, "rte");
  for (const container of [
    ...tracks.flatMap((t) => children(t, "trkseg")),
    ...routes,
  ]) {
    const points: Point[] = [];
    for (const el of Array.from(container.children).filter((e) =>
      ["trkpt", "rtept"].includes(e.localName),
    )) {
      const latitude = el.getAttribute("lat"),
        longitude = el.getAttribute("lon");
      const lat = Number(latitude),
        lon = Number(longitude);
      if (
        !latitude?.trim() ||
        !longitude?.trim() ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      )
        throw new Error("包含无效 GPS 坐标");
      const time = value(el, "time"),
        elevation = value(el, "ele");
      points.push({
        lat,
        lon,
        time:
          time &&
          /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(time) &&
          Number.isFinite(Date.parse(time))
            ? new Date(time).toISOString()
            : null,
        elevation:
          elevation !== null && Number.isFinite(Number(elevation))
            ? Number(elevation)
            : null,
        speed: recordedSpeed(el),
      });
    }
    if (points.length) segments.push(points);
  }
  if (!segments.some((s) => s.length >= 2))
    throw new Error("无有效 GPS 路线（至少需要两个连续轨迹点）");
  return { segments, tracks, routes };
}

/** Reuse the original parser when reading telemetry from an older saved GPX. */
export const gpxSegments = (raw: string) => readGpx(raw).segments;

export async function parseGpx(raw: string, filename: string): Promise<Ride> {
  const { segments, tracks, routes } = readGpx(raw);
  const points = segments.flat();
  const distance = segments.reduce(
    (total, s) =>
      total + s.slice(1).reduce((n, p, i) => n + distanceBetween(s[i], p), 0),
    0,
  );
  const complete = points.every((p) => p.time !== null);
  const monotonic =
    complete &&
    points.every(
      (p, i) => !i || Date.parse(p.time!) >= Date.parse(points[i - 1].time!),
    );
  const elapsed = monotonic
    ? (Date.parse(points.at(-1)!.time!) - Date.parse(points[0].time!)) / 1000
    : null;
  // Fingerprint normalized geometry, segment boundaries and times, independent of XML formatting/name.
  const canonical = JSON.stringify(
    segments.map((s) => s.map((p) => [p.lat, p.lon, p.time])),
  );
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  const id = Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return {
    id,
    name:
      tracks.map((t) => value(t, "name")).find(Boolean) ||
      routes.map((t) => value(t, "name")).find(Boolean) ||
      filename.replace(/\.gpx$/i, ""),
    date: points.find((p) => p.time)?.time ?? null,
    distance,
    duration: elapsed !== null && elapsed > 0 ? elapsed : null,
    segments,
    filename,
    importedAt: new Date().toISOString(),
  };
}
