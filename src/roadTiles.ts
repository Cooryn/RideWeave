import type { Feature, Geometry } from "geojson";
import type { Ride } from "./types";
import { ROAD_CLASSES } from "./roadMatching";
import { roadTileLines } from "./roadNetworkTiles";
import { singleRoadNetwork } from "./roadNetwork";
import { trackContinuity, pauseCorridor } from "./trackGaps";

const ZOOM = 14,
  N = 2 ** ZOOM,
  MAX_TILES = 256;
const cache = new Map<string, Feature<Geometry>[]>();
const tilePoint = (lon: number, lat: number) => [
  ((lon + 180) / 360) * N,
  ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * N,
];
export function roadTilePlan(rides: Ride[]) {
  const tiles = new Map<string, { x: number; y: number }>();
  const add = (lon: number, lat: number, width = 40) => {
    if (
      !Number.isFinite(lon + lat) ||
      Math.abs(lat) > 85 ||
      Math.abs(lon) > 180
    )
      return;
    const [x, y] = tilePoint(lon, lat);
    // Include a 40 m corridor so roads and junctions across tile boundaries are available.
    const margin = width / ((40030228 / N) * Math.cos((lat * Math.PI) / 180));
    for (let tx = Math.floor(x - margin); tx <= Math.floor(x + margin); tx++)
      for (
        let ty = Math.floor(y - margin);
        ty <= Math.floor(y + margin);
        ty++
      ) {
        if (ty < 0 || ty >= N) continue;
        const wrappedX = (tx + N) % N;
        tiles.set(`${wrappedX}/${ty}`, { x: wrappedX, y: ty });
      }
  };
  for (const ride of rides) {
    const plan = trackContinuity(ride.segments);
    for (const segment of plan.chunks)
      for (let i = 1; i < segment.length; i++) {
        const a = segment[i - 1],
          b = segment[i];
        const length =
          Math.hypot(
            (b.lon - a.lon) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180),
            b.lat - a.lat,
          ) * 111195;
        if (!Number.isFinite(length) || length > 300) continue;
        const steps = Math.max(1, Math.ceil(length / 40));
        for (let j = 0; j <= steps; j++)
          add(
            a.lon + ((b.lon - a.lon) * j) / steps,
            a.lat + ((b.lat - a.lat) * j) / steps,
          );
      }
    for (const gap of plan.gaps) {
      const a = gap.before.at(-1)!,
        b = gap.after[0],
        steps = Math.max(1, Math.ceil(gap.distance / 40));
      const width = pauseCorridor(gap.distance);
      for (let i = 0; i <= steps; i++)
        add(
          a.lon + ((b.lon - a.lon) * i) / steps,
          a.lat + ((b.lat - a.lat) * i) / steps,
          width,
        );
    }
  }
  return {
    tiles: [...tiles.values()].slice(0, MAX_TILES),
    omitted: Math.max(0, tiles.size - MAX_TILES),
  };
}

async function request(url: string, signal: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 20 * 1024 * 1024) throw new Error("道路瓦片过大");
    return buffer;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

/** Only standard public map tile URLs leave the device; GPS files/times are never sent. */
export async function loadRoadTiles(rides: Ride[], signal: AbortSignal) {
  const plan = roadTilePlan(rides),
    roads: Feature<Geometry>[] = [];
  if (!plan.tiles.length) return { roads, failed: 0, omitted: plan.omitted };
  // Reuse the provider's TileJSON, including its current versioned tile URL.
  let template: string;
  try {
    const data = JSON.parse(
      new TextDecoder().decode(
        await request("https://tiles.openfreemap.org/planet", signal),
      ),
    );
    template = data.tiles?.[0];
    if (
      typeof template !== "string" ||
      !template.startsWith("https://tiles.openfreemap.org/") ||
      !["{z}", "{x}", "{y}"].every((s) => template.includes(s))
    )
      throw new Error("道路源无效");
  } catch (error) {
    if (signal.aborted) throw error;
    // The last successful tile set remains useful offline during this app session.
    let failed = 0;
    for (const tile of plan.tiles) {
      const found = cache.get(`${ZOOM}/${tile.x}/${tile.y}`);
      if (found) roads.push(...found);
      else failed++;
    }
    return { roads: singleRoadNetwork(roads), failed, omitted: plan.omitted };
  }
  let cursor = 0,
    failed = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, plan.tiles.length) }, async () => {
      while (cursor < plan.tiles.length && !signal.aborted) {
        const tile = plan.tiles[cursor++],
          key = `${ZOOM}/${tile.x}/${tile.y}`;
        try {
          let features = cache.get(key);
          if (!features) {
            const url = template
              .replace("{z}", String(ZOOM))
              .replace("{x}", String(tile.x))
              .replace("{y}", String(tile.y));
            features = roadTileLines(
              await request(url, signal),
              tile.x,
              tile.y,
              ZOOM,
            ).filter((f) => ROAD_CLASSES.has(String(f.properties?.class)));
            cache.set(key, features);
            if (cache.size > 384) cache.delete(cache.keys().next().value!);
          }
          roads.push(...features);
        } catch {
          failed++;
        }
      }
    }),
  );
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  return { roads: singleRoadNetwork(roads), failed, omitted: plan.omitted };
}
