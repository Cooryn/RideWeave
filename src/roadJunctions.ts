type XY = [number, number];
export type JunctionSegment = {
  a: string;
  b: string;
  grade: string;
  merged: boolean;
  collapsible: boolean;
  protected?: boolean;
};
const distance = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const scaleAt = (p: XY) => 1 / Math.cosh(p[1] / 6378137);

/** Contract small median/turning cells bounded by confirmed carriageway pairs.
 * This uses existing graph connections, never proximity alone. Protected rings,
 * ramps, side streets and other grades cannot be used to complete a cell.
 */
export function refineRoadJunctions(
  segments: JunctionSegment[],
  position: (id: string) => XY,
): Map<string, XY> {
  const anchors = new Set<string>(),
    protectedNodes = new Set<string>();
  for (const e of segments)
    if (e.protected) {
      protectedNodes.add(e.a);
      protectedNodes.add(e.b);
    }
  for (const e of segments)
    if (e.merged) {
      anchors.add(e.a);
      anchors.add(e.b);
    }
  const edges: (JunctionSegment & { length: number })[] = [],
    adjacency = new Map<string, number[]>(),
    seen = new Set<string>();
  for (const e of segments) {
    if (!e.collapsible || e.a === e.b) continue;
    const key = [e.a, e.b].sort().join(";") + e.grade;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = position(e.a),
      b = position(e.b),
      length = distance(a, b) * scaleAt(a);
    if (length < 0.05) continue;
    const index = edges.length;
    edges.push({ ...e, length });
    for (const id of [e.a, e.b]) {
      if (!adjacency.has(id)) adjacency.set(id, []);
      adjacency.get(id)!.push(index);
    }
  }
  const parents = new Map<string, string>(),
    members = new Map<string, Set<string>>();
  function root(id: string): string {
    const parent = parents.get(id);
    if (!parent) {
      parents.set(id, id);
      members.set(id, new Set([id]));
      return id;
    }
    if (parent === id) return id;
    const found = root(parent);
    parents.set(id, found);
    return found;
  }
  function bounds(ids: Iterable<string>) {
    let west = Infinity,
      east = -Infinity,
      south = Infinity,
      north = -Infinity;
    for (const id of ids) {
      const [x, y] = position(id);
      west = Math.min(west, x);
      east = Math.max(east, x);
      south = Math.min(south, y);
      north = Math.max(north, y);
    }
    return {
      center: [(west + east) / 2, (south + north) / 2] as XY,
      diameter:
        Math.hypot(east - west, north - south) *
        scaleAt([0, (south + north) / 2]),
    };
  }
  const cells = new Set<string>();
  edges.forEach((edge, index) => {
    if (edge.merged || edge.length > 55) return;
    const queue = [{ id: edge.a, length: 0, path: [] as number[] }],
      best = new Map([[edge.a, 0]]);
    let visits = 0;
    while (queue.length && visits++ < 120) {
      queue.sort((a, b) => a.length - b.length);
      const current = queue.shift()!;
      if (current.length > (best.get(current.id) ?? Infinity)) continue;
      if (current.length + edge.length > 120) break;
      if (current.id === edge.b) {
        const cycle = [index, ...current.path].sort((a, b) => a - b),
          key = cycle.join(",");
        if (cells.has(key)) break;
        cells.add(key);
        const ids = new Set(cycle.flatMap((i) => [edges[i].a, edges[i].b]));
        const anchorCount = [...ids].filter((id) => anchors.has(id)).length;
        const diameter = bounds(ids).diameter;
        if (
          !anchorCount ||
          diameter > 56 ||
          [...ids].some((id) => protectedNodes.has(id)) ||
          (anchorCount === 1 &&
            (diameter > 24 || current.length + edge.length > 60))
        )
          break;
        const roots = new Set([...ids].map(root));
        const combined = new Set(
          [...roots].flatMap((id) => [...members.get(id)!]),
        );
        // Bound the entire cluster as well: neighbouring junctions must not
        // collapse through a chain of individually small cells.
        if (bounds(combined).diameter > 70) break;
        const representative = [...roots].sort()[0];
        for (const id of roots) {
          parents.set(id, representative);
          if (id !== representative) members.delete(id);
        }
        members.set(representative, combined);
        break;
      }
      for (const i of adjacency.get(current.id) ?? []) {
        if (i === index) continue;
        const next = edges[i];
        if (next.grade !== edge.grade) continue;
        const id = next.a === current.id ? next.b : next.a,
          length = current.length + next.length;
        if (length + edge.length > 120 || length >= (best.get(id) ?? Infinity))
          continue;
        best.set(id, length);
        queue.push({ id, length, path: [...current.path, i] });
      }
    }
  });
  const result = new Map<string, XY>();
  for (const ids of members.values())
    if (ids.size > 1) {
      const p = bounds(ids).center;
      for (const id of ids) result.set(id, p);
    }
  return result;
}
