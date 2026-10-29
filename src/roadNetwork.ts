import type { Feature, Geometry, LineString } from "geojson";
import { refineRoadJunctions } from "./roadJunctions";

type XY = [number, number];
type Properties = NonNullable<Feature["properties"]>;
type Edge = {
  a: XY;
  b: XY;
  length: number;
  properties: Properties;
  grade: string;
  direction: number;
  way: number;
  protected: boolean;
  cuts: Set<number>;
  covered: [number, number][];
};
const R = 6378137;
const classes = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
]);
const lerp = (a: XY, b: XY, t: number): XY => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const distance = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const project = (p: XY, e: Edge) =>
  ((p[0] - e.a[0]) * (e.b[0] - e.a[0]) + (p[1] - e.a[1]) * (e.b[1] - e.a[1])) /
  e.length ** 2;
const clamp = (t: number) => Math.max(0, Math.min(1, t));
const xy = ([lon, lat]: number[]): XY => [
  (R * lon * Math.PI) / 180,
  R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];
const ll = ([x, y]: XY): XY => [
  ((x / R) * 180) / Math.PI,
  ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI,
];
const grade = (p: Properties) =>
  `${p.layer ?? 0}:${p.brunnel ?? ""}:${p.level ?? 0}`;
const identity = (p: Properties) => String(p.name ?? p.ref ?? "").trim();
const knownLayer = (p: Properties) =>
  p.layer !== undefined && p.layer !== null && Number.isFinite(Number(p.layer));
const compatibleGrade = (a: Edge, b: Edge) =>
  a.grade === b.grade ||
  (["bridge", "tunnel"].includes(String(a.properties.brunnel)) &&
    a.properties.brunnel === b.properties.brunnel &&
    (a.properties.level ?? 0) === (b.properties.level ?? 0) &&
    (!knownLayer(a.properties) || !knownLayer(b.properties)));

function direction(p: Properties) {
  const d = Number(p.oneway);
  if (
    !classes.has(p.class) ||
    (d !== 1 && d !== -1) ||
    Number(p.ramp) === 1 ||
    p.junction === "roundabout"
  )
    return 0;
  // Two unnamed residential streets are insufficient evidence of a divided road.
  if (p.class === "minor" && !identity(p)) return 0;
  return d;
}

/** Collapse close, opposite one-way carriageways onto a shared, undirected line.
 * Geometry only: stored GPS and its statistics are never changed. Ambiguous or
 * unsupported roads retain their original geometry. Work in global Mercator
 * coordinates so buffered neighbouring tiles calculate the same midpoints.
 */
export function singleRoadNetwork(
  roads: Feature<Geometry>[],
): Feature<Geometry>[] {
  const edges: Edge[] = [],
    other: Feature<Geometry>[] = [];
  const pointKey = (p: XY) => p.map((v) => v.toFixed(2)).join(",");
  const endpointLevels = new Map<string, Set<string>>();
  const endpoints: { point: XY; properties: Properties }[] = [];
  const wayIds = new Map<string, number>();
  const rawEdges = new Set<string>();
  let way = 0;
  for (const road of roads) {
    const lines =
      road.geometry.type === "LineString"
        ? [road.geometry.coordinates]
        : road.geometry.type === "MultiLineString"
          ? road.geometry.coordinates
          : null;
    if (!lines) {
      other.push(road);
      continue;
    }
    const properties = { ...road.properties };
    for (const line of lines) {
      way++;
      const wayKey =
        road.id === undefined
          ? null
          : `${road.id}:${properties.class}:${properties.brunnel ?? ""}`;
      if (wayKey && !wayIds.has(wayKey)) wayIds.set(wayKey, way);
      for (const p of [line[0], line.at(-1)]) {
        if (!p || !p.every(Number.isFinite) || Math.abs(p[1]) > 85) continue;
        endpoints.push({ point: xy(p), properties });
      }
      const closed =
        line.length > 2 &&
        line[0][0] === line.at(-1)![0] &&
        line[0][1] === line.at(-1)![1];
      for (let i = 1; i < line.length; i++) {
        if (
          ![...line[i - 1], ...line[i]].every(Number.isFinite) ||
          Math.abs(line[i - 1][1]) > 85 ||
          Math.abs(line[i][1]) > 85
        )
          continue;
        const a = xy(line[i - 1]),
          b = xy(line[i]),
          length = distance(a, b);
        if (length < 0.01) continue;
        const rawKey = `${pointKey(a)};${pointKey(b)}|${JSON.stringify(properties)}`;
        if (rawEdges.has(rawKey)) continue;
        rawEdges.add(rawKey);
        edges.push({
          a,
          b,
          length,
          properties,
          grade: grade(properties),
          direction: closed ? 0 : direction(properties),
          way: wayKey ? wayIds.get(wayKey)! : way,
          protected: closed || properties.junction === "roundabout",
          cuts: new Set([0, 1]),
          covered: [],
        });
      }
    }
  }
  // Stable ordering also makes results independent of tile feature order.
  edges.sort((a, b) =>
    `${pointKey(a.a)};${pointKey(a.b)}`.localeCompare(
      `${pointKey(b.a)};${pointKey(b.b)}`,
    ),
  );
  const grid = new Map<string, Set<number>>(),
    cell = 100;
  function cells(e: Edge, visit: (x: number, y: number) => void) {
    const steps = Math.max(1, Math.ceil(e.length / (cell / 2)));
    for (let i = 0; i <= steps; i++) {
      const p = lerp(e.a, e.b, i / steps);
      visit(Math.floor(p[0] / cell), Math.floor(p[1] / cell));
    }
  }
  edges.forEach((e, i) => {
    if (!e.direction) return;
    cells(e, (x, y) => {
      const key = `${x},${y}`;
      if (!grid.has(key)) grid.set(key, new Set());
      grid.get(key)!.add(i);
    });
  });
  const junctions = new Map<string, { point: XY; distance: number }>();
  type Pair = {
    i: number;
    j: number;
    lo: number;
    hi: number;
    from: number;
    to: number;
    separation: number;
  };
  let pairs: Pair[] = [];
  const layerSuggestions = new Map<Properties, Set<number>>();
  edges.forEach((a, i) => {
    if (!a.direction) return;
    const nearby = new Set<number>();
    cells(a, (x, y) => {
      // 100 Mercator metres cover 32 ground metres even at the supported latitudes.
      const radius = Math.ceil(
        32 / Math.cos((ll(a.a)[1] * Math.PI) / 180) / cell,
      );
      for (let dx = -radius; dx <= radius; dx++)
        for (let dy = -radius; dy <= radius; dy++)
          grid.get(`${x + dx},${y + dy}`)?.forEach((j) => nearby.add(j));
    });
    for (const j of nearby) {
      const b = edges[j];
      if (
        j <= i ||
        a.way === b.way ||
        !b.direction ||
        !compatibleGrade(a, b) ||
        a.properties.class !== b.properties.class ||
        (a.properties.subclass ?? "") !== (b.properties.subclass ?? "")
      )
        continue;
      if (
        ["name", "ref"].some(
          (key) =>
            a.properties[key] &&
            b.properties[key] &&
            a.properties[key] !== b.properties[key],
        )
      )
        continue;
      const dot =
        ((a.b[0] - a.a[0]) * (b.b[0] - b.a[0]) +
          (a.b[1] - a.a[1]) * (b.b[1] - b.a[1])) /
        (a.length * b.length);
      if (dot * a.direction * b.direction > -0.985) continue;
      const t0 = project(b.a, a),
        t1 = project(b.b, a),
        lo = Math.max(0, Math.min(t0, t1)),
        hi = Math.min(1, Math.max(t0, t1));
      if (hi <= lo) continue;
      const p = lerp(a.a, a.b, lo),
        q = lerp(a.a, a.b, hi),
        from = clamp(project(p, b)),
        to = clamp(project(q, b));
      const scale = Math.cos((ll(lerp(p, q, 0.5))[1] * Math.PI) / 180);
      const offsets = [
        distance(p, lerp(b.a, b.b, from)) * scale,
        distance(q, lerp(b.a, b.b, to)) * scale,
      ];
      if (
        Math.min(...offsets) < 3 ||
        Math.max(...offsets) > 32 ||
        Math.min((hi - lo) * a.length, Math.abs(to - from) * b.length) * scale <
          4
      )
        continue;
      pairs.push({
        i,
        j,
        lo,
        hi,
        from,
        to,
        separation: (offsets[0] + offsets[1]) / 2,
      });
      for (const [unknown, known] of [
        [a, b],
        [b, a],
      ])
        if (
          ["bridge", "tunnel"].includes(String(unknown.properties.brunnel)) &&
          !knownLayer(unknown.properties) &&
          knownLayer(known.properties)
        ) {
          if (!layerSuggestions.has(unknown.properties))
            layerSuggestions.set(unknown.properties, new Set());
          layerSuggestions
            .get(unknown.properties)!
            .add(Number(known.properties.layer));
        }
    }
  });
  // A missing layer on one side of the same bridge is not evidence of a
  // different height. Infer only from one unambiguous opposite carriageway;
  // explicit differing layers and conflicting suggestions remain separate.
  for (const [properties, values] of layerSuggestions)
    if (values.size === 1) properties.layer = [...values][0];
  for (const e of edges) e.grade = grade(e.properties);
  pairs = pairs.filter((p) => edges[p.i].grade === edges[p.j].grade);
  if (!pairs.length) return roads;
  const activeProperties = new Set(edges.map((e) => e.properties));
  for (const { point, properties } of endpoints) {
    if (!activeProperties.has(properties)) continue;
    const key = pointKey(point);
    if (!endpointLevels.has(key)) endpointLevels.set(key, new Set());
    endpointLevels.get(key)!.add(grade(properties));
  }
  // Carry side-street endpoints with the normalized centreline junctions.
  for (const e of edges)
    for (const p of [e.a, e.b]) {
      const x = Math.floor(p[0] / cell),
        y = Math.floor(p[1] / cell);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const i of grid.get(`${x + dx},${y + dy}`) ?? []) {
            const target = edges[i],
              t = clamp(project(p, target)),
              q = lerp(target.a, target.b, t);
            const offset =
              distance(p, q) * Math.cos((ll(p)[1] * Math.PI) / 180);
            const angle = Math.abs(
              ((e.b[0] - e.a[0]) * (target.b[1] - target.a[1]) -
                (e.b[1] - e.a[1]) * (target.b[0] - target.a[0])) /
                (e.length * target.length),
            );
            const tolerance =
              endpointLevels.has(pointKey(p)) && angle > 0.15 ? 1.5 : 0.005;
            if (target.grade === e.grade && offset < tolerance) {
              target.cuts.add(t);
              const key = `${pointKey(p)}|${e.grade}`;
              if (
                pointKey(p) !== pointKey(q) &&
                offset < (junctions.get(key)?.distance ?? Infinity)
              )
                junctions.set(key, { point: q, distance: offset });
            }
          }
    }
  const byEdge = new Map<number, Pair[]>();
  for (const pair of pairs)
    for (const index of [pair.i, pair.j]) {
      if (!byEdge.has(index)) byEdge.set(index, []);
      byEdge.get(index)!.push(pair);
    }
  function ambiguous(pair: Pair) {
    return [pair.i, pair.j].some((index) => {
      const current =
        index === pair.i
          ? [pair.lo, pair.hi]
          : [Math.min(pair.from, pair.to), Math.max(pair.from, pair.to)];
      const mid = (current[0] + current[1]) / 2;
      return byEdge.get(index)!.some((other) => {
        if (other === pair || Math.abs(other.separation - pair.separation) > 3)
          return false;
        const range =
          index === other.i
            ? [other.lo, other.hi]
            : [Math.min(other.from, other.to), Math.max(other.from, other.to)];
        const partner = index === pair.i ? pair.j : pair.i,
          alternative = index === other.i ? other.j : other.i;
        return (
          edges[partner].way !== edges[alternative].way &&
          mid > range[0] + 1e-6 &&
          mid < range[1] - 1e-6
        );
      });
    });
  }
  pairs.sort((a, b) => a.separation - b.separation || a.i - b.i || a.j - b.j);
  const parents = new Map<string, string>(),
    positions = new Map<string, XY>();
  function node(p: XY, level: string) {
    const original = pointKey(p);
    p = junctions.get(`${original}|${level}`)?.point ?? p;
    const key = `${pointKey(p)}|${(endpointLevels.get(original)?.size ?? 0) > 1 ? "junction" : level}`;
    if (!parents.has(key)) {
      parents.set(key, key);
      positions.set(key, p);
    }
    return key;
  }
  function root(key: string): string {
    const parent = parents.get(key)!;
    if (parent === key) return key;
    const result = root(parent);
    parents.set(key, result);
    return result;
  }
  function join(a: XY, b: XY, level: string) {
    const u = root(node(a, level)),
      v = root(node(b, level));
    if (u !== v) parents.set(v, u);
  }
  const sameWay = new Map<number, Edge[]>();
  for (const e of edges) {
    if (!sameWay.has(e.way)) sameWay.set(e.way, []);
    sameWay.get(e.way)!.push(e);
  }
  // A buffered copy of the same OSM way must not survive as a second lane
  // after one copy has already contributed to the centreline.
  function claim(e: Edge, lo: number, hi: number) {
    e.covered.push([lo, hi]);
    for (const copy of sameWay.get(e.way) ?? []) {
      if (copy === e || copy.grade !== e.grade) continue;
      const dot =
        ((copy.b[0] - copy.a[0]) * (e.b[0] - e.a[0]) +
          (copy.b[1] - copy.a[1]) * (e.b[1] - e.a[1])) /
        (copy.length * e.length);
      if (Math.abs(dot) < 0.9995) continue;
      const from = clamp(project(lerp(e.a, e.b, lo), copy)),
        to = clamp(project(lerp(e.a, e.b, hi), copy));
      if (Math.abs(to - from) * copy.length < 0.05) continue;
      const points = [from, to].map((t) => lerp(copy.a, copy.b, t));
      const scale = Math.cos((ll(e.a)[1] * Math.PI) / 180);
      if (
        points.some(
          (p) =>
            distance(p, lerp(e.a, e.b, clamp(project(p, e)))) * scale > 1.5,
        )
      )
        continue;
      copy.covered.push([Math.min(from, to), Math.max(from, to)]);
      for (const t of [from, to]) {
        copy.cuts.add(t);
        const p = lerp(copy.a, copy.b, t),
          onOriginal = clamp(project(p, e));
        e.cuts.add(onOriginal);
        const q = lerp(e.a, e.b, onOriginal);
        if (pointKey(p) !== pointKey(q))
          junctions.set(`${pointKey(p)}|${copy.grade}`, {
            point: q,
            distance: distance(p, q) * scale,
          });
      }
    }
  }
  const selected: Pair[] = [];
  for (const pair of pairs) {
    if (ambiguous(pair)) continue;
    const a = edges[pair.i],
      b = edges[pair.j];
    const onB = (t: number) =>
      pair.from + ((t - pair.lo) / (pair.hi - pair.lo)) * (pair.to - pair.from);
    const onA = (t: number) =>
      pair.lo + ((t - pair.from) / (pair.to - pair.from)) * (pair.hi - pair.lo);
    const cuts = [
      ...new Set(
        [
          pair.lo,
          pair.hi,
          ...a.cuts,
          ...[...b.cuts].map(onA),
          ...a.covered.flat(),
          ...b.covered.flat().map(onA),
        ].filter((t) => t >= pair.lo && t <= pair.hi),
      ),
    ].sort((x, y) => x - y);
    for (let k = 1; k < cuts.length; k++) {
      const lo = cuts[k - 1],
        hi = cuts[k],
        mid = (lo + hi) / 2;
      if (
        (hi - lo) * a.length < 0.05 ||
        a.covered.some(([x, y]) => mid > x - 1e-9 && mid < y + 1e-9) ||
        b.covered.some(([x, y]) => onB(mid) > x - 1e-9 && onB(mid) < y + 1e-9)
      )
        continue;
      const from = onB(lo),
        to = onB(hi);
      claim(a, lo, hi);
      claim(b, Math.min(from, to), Math.max(from, to));
      a.cuts.add(lo);
      a.cuts.add(hi);
      b.cuts.add(from);
      b.cuts.add(to);
      selected.push({ ...pair, lo, hi, from, to });
    }
  }
  if (!selected.length) return roads;
  // Finish all junction cuts before emitting centreline geometry. A later pair
  // can introduce a cut inside an earlier pair; emitting it immediately used to
  // leave a branch attached to an unsplit, slightly offset centreline segment.
  function addCut(e: Edge, t: number) {
    if ([...e.cuts].some((c) => Math.abs(c - t) * e.length < 0.01))
      return false;
    e.cuts.add(clamp(t));
    return true;
  }
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const pair of selected) {
      const a = edges[pair.i],
        b = edges[pair.j];
      const onB = (t: number) =>
        pair.from +
        ((t - pair.lo) / (pair.hi - pair.lo)) * (pair.to - pair.from);
      const onA = (t: number) =>
        pair.lo +
        ((t - pair.from) / (pair.to - pair.from)) * (pair.hi - pair.lo);
      for (const t of [...a.cuts])
        if (t > pair.lo && t < pair.hi) changed = addCut(b, onB(t)) || changed;
      for (const t of [...b.cuts])
        if (
          t > Math.min(pair.from, pair.to) &&
          t < Math.max(pair.from, pair.to)
        )
          changed = addCut(a, onA(t)) || changed;
    }
    if (!changed) break;
  }
  type Segment = {
    a: string;
    b: string;
    properties: Properties;
    merged: boolean;
    collapsible: boolean;
    protected?: boolean;
  };
  const segments: Segment[] = [];
  for (const pair of selected) {
    const a = edges[pair.i],
      b = edges[pair.j];
    const onB = (t: number) =>
      pair.from + ((t - pair.lo) / (pair.hi - pair.lo)) * (pair.to - pair.from);
    const cuts = [
      ...new Set(
        [pair.lo, pair.hi, ...a.cuts].filter(
          (t) => t >= pair.lo && t <= pair.hi,
        ),
      ),
    ].sort((x, y) => x - y);
    for (let i = 1; i < cuts.length; i++) {
      const lo = cuts[i - 1],
        hi = cuts[i];
      if ((hi - lo) * a.length < 0.01) continue;
      const p = lerp(a.a, a.b, lo),
        q = lerp(a.a, a.b, hi);
      join(p, lerp(b.a, b.b, onB(lo)), a.grade);
      join(q, lerp(b.a, b.b, onB(hi)), a.grade);
      segments.push({
        a: node(p, a.grade),
        b: node(q, a.grade),
        properties: { ...a.properties, oneway: 0 },
        merged: true,
        collapsible: true,
      });
    }
  }
  for (const e of edges) {
    const cuts = [...e.cuts].sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const lo = cuts[i - 1],
        hi = cuts[i],
        mid = (lo + hi) / 2;
      if (e.covered.some(([a, b]) => mid >= a - 1e-9 && mid <= b + 1e-9))
        continue;
      segments.push({
        a: node(lerp(e.a, e.b, lo), e.grade),
        b: node(lerp(e.a, e.b, hi), e.grade),
        properties: e.properties,
        merged: false,
        collapsible: e.direction !== 0,
        protected: e.protected,
      });
    }
  }
  // Move every incident edge with its junction, including side streets and ramps.
  const sums = new Map<string, { x: number; y: number; count: number }>();
  for (const [key, p] of positions) {
    const id = root(key),
      sum = sums.get(id) ?? { x: 0, y: 0, count: 0 };
    sum.x += p[0];
    sum.y += p[1];
    sum.count++;
    sums.set(id, sum);
  }
  const position = (key: string): XY => {
    const sum = sums.get(root(key));
    return sum ? [sum.x / sum.count, sum.y / sum.count] : positions.get(key)!;
  };
  const refined = refineRoadJunctions(
    segments.map((e) => ({
      ...e,
      a: root(e.a),
      b: root(e.b),
      grade: grade(e.properties),
    })),
    position,
  );
  const junctionPosition = (key: string) =>
    refined.get(root(key)) ?? position(key);
  const output: Feature<Geometry>[] = [...other],
    seen = new Set<string>();
  function add(a: XY, b: XY, properties: Properties) {
    if (distance(a, b) < 0.05) return;
    const key =
      [pointKey(a), pointKey(b)].sort().join(";") +
      grade(properties) +
      properties.class;
    if (seen.has(key)) return;
    seen.add(key);
    const coordinates = [ll(a), ll(b)].map((p) =>
      p.map((v) => Number(v.toFixed(7))),
    );
    output.push({
      type: "Feature",
      properties,
      geometry: { type: "LineString", coordinates },
    } as Feature<LineString>);
  }
  for (const e of segments)
    add(junctionPosition(e.a), junctionPosition(e.b), e.properties);
  return stitch(output);
}

// Rejoin degree-two chains after pairing so the reference keeps compact polylines
// and MapLibre draws real joins rather than a cap at every original vertex.
function stitch(features: Feature<Geometry>[]): Feature<Geometry>[] {
  const result: Feature<Geometry>[] = [];
  const groups = new Map<string, Feature<LineString>[]>();
  for (const f of features) {
    if (f.geometry.type !== "LineString") {
      result.push(f);
      continue;
    }
    const key = JSON.stringify(
      Object.entries(f.properties ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    );
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f as Feature<LineString>);
  }
  for (const lines of groups.values()) {
    const adjacency = new Map<string, number[]>(),
      used = new Set<number>();
    const key = (p: number[]) => p.join(",");
    lines.forEach((f, i) => {
      for (const p of [
        f.geometry.coordinates[0],
        f.geometry.coordinates.at(-1)!,
      ]) {
        const id = key(p);
        if (!adjacency.has(id)) adjacency.set(id, []);
        adjacency.get(id)!.push(i);
      }
    });
    function walk(index: number, start: number[]) {
      const coordinates = [start];
      while (!used.has(index)) {
        used.add(index);
        const line = lines[index].geometry.coordinates,
          end = key(coordinates.at(-1)!);
        coordinates.push(
          ...(key(line[0]) === end
            ? line.slice(1)
            : line.slice(0, -1).reverse()),
        );
        const next = adjacency.get(key(coordinates.at(-1)!))!;
        if (next.length !== 2) break;
        const candidate = next.find((i) => !used.has(i));
        if (candidate === undefined) break;
        index = candidate;
      }
      result.push({
        ...lines[index],
        geometry: { type: "LineString", coordinates },
      });
    }
    // Start at ends and junctions; process any remaining closed loops afterwards.
    lines.forEach((f, i) => {
      if (used.has(i)) return;
      const a = f.geometry.coordinates[0],
        b = f.geometry.coordinates.at(-1)!;
      if (adjacency.get(key(a))!.length !== 2) walk(i, a);
      else if (adjacency.get(key(b))!.length !== 2) walk(i, b);
    });
    lines.forEach((f, i) => {
      if (!used.has(i)) walk(i, f.geometry.coordinates[0]);
    });
  }
  return result;
}
