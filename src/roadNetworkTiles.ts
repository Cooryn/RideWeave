import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { singleRoadNetwork } from "./roadNetwork";
import type { Feature, Geometry } from "geojson";

export function roadTileLines(
  buffer: ArrayBuffer,
  x: number,
  y: number,
  z: number,
) {
  const tile = new VectorTile(new Pbf(new Uint8Array(buffer)));
  const layer = tile.layers.transportation;
  const lines: Feature<Geometry>[] = [];
  for (let i = 0; i < (layer?.length ?? 0); i++) {
    const feature = layer.feature(i);
    if (feature.type === 2) lines.push(feature.toGeoJSON(x, y, z));
  }
  return lines;
}

/** Private matching geometry for GPX overlays. Never replaces basemap tiles. */
export function roadNetworkTile(
  buffer: ArrayBuffer,
  x: number,
  y: number,
  z: number,
) {
  const lines = roadTileLines(buffer, x, y, z);
  return { roads: z >= 12 ? singleRoadNetwork(lines) : lines };
}
