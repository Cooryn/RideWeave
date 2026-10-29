import type { Feature, FeatureCollection, Geometry, LineString } from "geojson";
import type { Ride } from "./types";
import { trackContinuity } from "./trackGaps";
export type RoadProperties = {
  /** Observed traversals, including repeated passes within the same ride. */
  count: number;
  rideIds: string[];
  inferred?: boolean;
  observedRideIds?: string[];
  inferredRideIds?: string[];
};
export type PauseLinks = FeatureCollection<LineString, { rideId: string }>;
export type RoadMatches = FeatureCollection<LineString, RoadProperties> & {
  pauseLinks?: PauseLinks;
};
type XY = [number, number];
type Edge = {
  a: XY;
  b: XY;
  length: number;
  u: string;
  v: string;
  grade: string;
  intervals: { lo: number; hi: number; id: string; inferred?: boolean }[];
};
type Candidate = {
  edge: number;
  t: number;
  distance: number;
  point: XY;
  alignment: number;
};
type Step = { edge: number; from: number; to: number };
const CELL = 50,
  TOLERANCE = 45;
export const ROAD_CLASSES = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
  "service",
  "track",
  "path",
  "raceway",
]);
const lerp = (a: XY, b: XY, t: number): XY => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const distance = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function project(p: XY, a: XY, b: XY) {
  const length = distance(a, b);
  const t =
    length < 1e-9
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) /
              length ** 2,
          ),
        );
  const point = lerp(a, b, t);
  return { t, point, distance: distance(p, point) };
}

/** Sequence-aware matching follows connected road geometry, never straight gap fillers. */
export function matchRoads(
  rides: Ride[],
  roads: Feature<Geometry>[],
): RoadMatches {
  const result: RoadMatches = { type: "FeatureCollection", features: [] };
  const pauseLinks: PauseLinks = { type: "FeatureCollection", features: [] };
  result.pauseLinks = pauseLinks;
  const origin = rides.flatMap((r) => r.segments).find((s) => s.length)?.[0];
  if (!origin || !roads.length) return result;
  const scale = 111195 * Math.cos((origin.lat * Math.PI) / 180);
  if (scale < 1000) return result;
  const xy = (p: number[]): XY => [
    (p[0] - origin.lon) * scale,
    (p[1] - origin.lat) * 111195,
  ];
  const ll = (p: XY): XY => [
    p[0] / scale + origin.lon,
    p[1] / 111195 + origin.lat,
  ];
  const node = (p: XY) =>
    ll(p)
      .map((n) => n.toFixed(6))
      .join(",");
  const canonical = (p: number[]) =>
    xy(p.slice(0, 2).map((n) => Number(n.toFixed(6))));
  const raw: Edge[] = [],
    seen = new Set<string>();
  const endpointGrades = new Map<string, Set<string>>();
  for (const road of roads) {
    if (!ROAD_CLASSES.has(String(road.properties?.class))) continue;
    const grade = `${road.properties?.layer ?? 0}:${road.properties?.brunnel ?? ""}`;
    const lines =
      road.geometry.type === "LineString"
        ? [road.geometry.coordinates]
        : road.geometry.type === "MultiLineString"
          ? road.geometry.coordinates
          : [];
    for (const line of lines)
      for (const p of [line[0], line.at(-1)]) {
        if (!p || !p.every(Number.isFinite)) continue;
        const key = node(canonical(p));
        if (!endpointGrades.has(key)) endpointGrades.set(key, new Set());
        endpointGrades.get(key)!.add(grade);
      }
    for (const line of lines)
      for (let i = 1; i < line.length; i++) {
        if (![...line[i - 1], ...line[i]].every(Number.isFinite)) continue;
        const a = canonical(line[i - 1]),
          b = canonical(line[i]),
          length = distance(a, b),
          u = node(a),
          v = node(b);
        const key = [u, v].sort().join(";") + grade;
        if (length < 0.3 || length > 20000 || seen.has(key)) continue;
        seen.add(key);
        raw.push({ a, b, length, u, v, grade, intervals: [] });
      }
  }
  const grid = new Map<string, Set<number>>();
  function indexEdge(e: Edge, index: number) {
    const steps = Math.ceil(e.length / (CELL / 2));
    for (let i = 0; i <= steps; i++) {
      const p = lerp(e.a, e.b, i / steps),
        key = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`;
      if (!grid.has(key)) grid.set(key, new Set());
      grid.get(key)!.add(index);
    }
  }
  function nearby(p: XY) {
    const found = new Set<number>(),
      x = Math.floor(p[0] / CELL),
      y = Math.floor(p[1] / CELL);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        grid.get(`${x + dx},${y + dy}`)?.forEach((i) => found.add(i));
    return found;
  }
  raw.forEach(indexEdge);
  // Split at existing endpoints, including T junctions and tile buffer clipping.
  // Vector tile quantization/simplification can move a junction slightly off its
  // receiving road. Allow 1.5 m only at real line ends meeting at an angle;
  // nearby parallel roads and ordinary interior vertices keep the strict limit.
  // Interior crossings are not synthesized; differing bridge/tunnel levels stay separate.
  const cuts = raw.map(() => new Map<number, XY>());
  for (const e of raw)
    for (const p of [e.a, e.b])
      for (const i of nearby(p)) {
        const other = raw[i];
        if (other.grade !== e.grade) continue;
        const q = project(p, other.a, other.b);
        const crossingAngle = Math.abs(
          ((e.b[0] - e.a[0]) * (other.b[1] - other.a[1]) -
            (e.b[1] - e.a[1]) * (other.b[0] - other.a[0])) /
            (e.length * other.length),
        );
        const tolerance =
          endpointGrades.has(node(p)) && crossingAngle > 0.15 ? 1.5 : 0.3;
        if (q.distance < tolerance && q.t > 1e-6 && q.t < 1 - 1e-6)
          cuts[i].set(q.t, p);
      }
  const edges: Edge[] = [],
    adjacency = new Map<string, number[]>();
  const graphNode = (p: XY, grade: string) => {
    const key = node(p),
      endpoints = endpointGrades.get(key);
    return endpoints && endpoints.size > 1 && endpoints.has(grade)
      ? key
      : `${key}|${grade}`;
  };
  seen.clear();
  grid.clear();
  raw.forEach((e, i) => {
    const points = [
      e.a,
      ...[...cuts[i]].sort(([a], [b]) => a - b).map(([, p]) => p),
      e.b,
    ];
    for (let j = 1; j < points.length; j++) {
      const a = points[j - 1],
        b = points[j],
        u = graphNode(a, e.grade),
        v = graphNode(b, e.grade),
        key = [u, v].sort().join(";") + e.grade;
      if (seen.has(key) || distance(a, b) < 0.3) continue;
      seen.add(key);
      const index = edges.length;
      edges.push({ ...e, a, b, u, v, length: distance(a, b), intervals: [] });
      for (const n of [u, v]) {
        if (!adjacency.has(n)) adjacency.set(n, []);
        adjacency.get(n)!.push(index);
      }
      indexEdge(edges[index], index);
    }
  });
  function candidates(p: XY, heading: XY) {
    const found: Candidate[] = [],
      len = Math.hypot(...heading);
    for (const i of nearby(p)) {
      const e = edges[i],
        alignment =
          len < 1
            ? 1
            : Math.abs(
                (heading[0] * (e.b[0] - e.a[0]) +
                  heading[1] * (e.b[1] - e.a[1])) /
                  (len * e.length),
              );
      if (alignment < 0.25) continue;
      const q = project(p, e.a, e.b);
      if (q.distance <= TOLERANCE) found.push({ ...q, edge: i, alignment });
    }
    return found.sort((a, b) => a.distance - b.distance).slice(0, 6);
  }
  function connect(
    a: Candidate,
    b: Candidate,
    gpsDistance: number,
  ): { length: number; steps: Step[] } | null {
    const limit = Math.max(40, gpsDistance * 2 + 20);
    if (a.edge === b.edge) {
      const length = Math.abs(a.t - b.t) * edges[a.edge].length;
      return length <= limit
        ? { length, steps: [{ edge: a.edge, from: a.t, to: b.t }] }
        : null;
    }
    const first = edges[a.edge],
      last = edges[b.edge];
    const queue = [
      {
        node: first.u,
        length: a.t * first.length,
        steps: [{ edge: a.edge, from: a.t, to: 0 }],
      },
      {
        node: first.v,
        length: (1 - a.t) * first.length,
        steps: [{ edge: a.edge, from: a.t, to: 1 }],
      },
    ];
    const visited = new Set<string>();
    let best: { length: number; steps: Step[] } | null = null;
    while (queue.length && visited.size < 250) {
      queue.sort((a, b) => a.length - b.length);
      const current = queue.shift()!;
      if (
        current.length > limit ||
        (best && current.length >= best.length) ||
        visited.has(current.node)
      )
        continue;
      visited.add(current.node);
      const end =
        current.node === last.u ? 0 : current.node === last.v ? 1 : null;
      if (end !== null) {
        const length = current.length + Math.abs(b.t - end) * last.length;
        if (length <= limit && (!best || length < best.length))
          best = {
            length,
            steps: [...current.steps, { edge: b.edge, from: end, to: b.t }],
          };
      }
      for (const index of adjacency.get(current.node) ?? []) {
        const e = edges[index],
          forward = e.u === current.node;
        if (index === a.edge || index === b.edge) continue;
        if (project(lerp(e.a, e.b, 0.5), a.point, b.point).distance > TOLERANCE)
          continue;
        if (current.length + e.length <= limit)
          queue.push({
            node: forward ? e.v : e.u,
            length: current.length + e.length,
            steps: [
              ...current.steps,
              { edge: index, from: forward ? 0 : 1, to: forward ? 1 : 0 },
            ],
          });
      }
    }
    return best;
  }
  type State = {
    match: Candidate;
    cost: number;
    previous?: State;
    steps: Step[];
    observation: number;
  };
  type Anchors = { start?: Candidate; end?: Candidate };
  function matchSequence(points: XY[], rideId: string) {
    const anchors: Anchors = {};
    if (points.length < 2) return anchors;
    // Use spatially spaced observations and a longer heading baseline, rather
    // than rejecting individual 1–5 m GPS steps whose heading is dominated by noise.
    const observations = [points[0]];
    for (let i = 1; i < points.length - 1; i++)
      if (distance(points[i], observations.at(-1)!) >= 12)
        observations.push(points[i]);
    if (distance(points.at(-1)!, observations.at(-1)!) > 0.1)
      observations.push(points.at(-1)!);
    let states: State[] = [],
      lastPoint: XY | undefined;
    const finish = () => {
      if (!states.length) return;
      states.sort((a, b) => a.cost - b.cost);
      const best = states[0];
      const trace = (last: State) => {
        const chain: State[] = [];
        for (let state: State | undefined = last; state; state = state.previous)
          chain.push(state);
        return chain.reverse();
      };
      const chain = trace(best);
      let certain = chain.length;
      // Keep the shared prefix when only the final fork is ambiguous. An
      // uncertain destination must not erase a confidently matched journey.
      for (const alternative of states) {
        if (
          alternative.cost - best.cost >= 1 ||
          distance(alternative.match.point, best.match.point) <= 2
        )
          continue;
        const other = trace(alternative);
        let common = 0;
        while (
          common < Math.min(certain, other.length) &&
          chain[common].match.edge === other[common].match.edge &&
          distance(chain[common].match.point, other[common].match.point) < 2
        )
          common++;
        certain = common;
      }
      const committed = chain.slice(0, certain);
      if (
        committed.length >= 2 &&
        committed.some((s) =>
          s.steps.some(
            (step) =>
              Math.abs(step.to - step.from) * edges[step.edge].length > 0.3,
          ),
        )
      ) {
        if (committed[0].observation === 0) anchors.start = committed[0].match;
        if (committed.at(-1)!.observation === observations.length - 1)
          anchors.end = committed.at(-1)!.match;
      }
      for (const state of chain.slice(0, certain))
        for (const step of state.steps) {
          if (Math.abs(step.to - step.from) * edges[step.edge].length > 0.01)
            edges[step.edge].intervals.push({
              lo: Math.min(step.from, step.to),
              hi: Math.max(step.from, step.to),
              id: rideId,
            });
        }
    };
    for (let i = 0; i < observations.length; i++) {
      const p = observations[i];
      const before = observations[Math.max(0, i - 1)],
        after = observations[Math.min(observations.length - 1, i + 1)];
      let heading: XY = [after[0] - before[0], after[1] - before[1]];
      if (Math.hypot(...heading) < 1)
        heading = [p[0] - before[0], p[1] - before[1]];
      const options = candidates(p, heading);
      if (!options.length) {
        if (lastPoint && distance(p, lastPoint) > 80) {
          finish();
          states = [];
          lastPoint = undefined;
        }
        continue;
      }
      const next: State[] = [];
      for (const option of options) {
        const emission =
          (option.distance / 12) ** 2 + (1 - option.alignment) * 0.5;
        let best: State | undefined;
        if (lastPoint)
          for (const previous of states) {
            const d = distance(lastPoint, p),
              route = connect(previous.match, option, d);
            if (!route) continue;
            const cost =
              previous.cost + emission + Math.abs(route.length - d) / 10;
            if (!best || cost < best.cost)
              best = {
                match: option,
                cost,
                previous,
                steps: route.steps,
                observation: i,
              };
          }
        if (best) next.push(best);
      }
      if (!next.length) {
        finish();
        states = options.map((match) => ({
          match,
          cost: (match.distance / 12) ** 2 + (1 - match.alignment) * 0.5,
          steps: [],
          observation: i,
        }));
      } else states = next;
      lastPoint = p;
    }
    finish();
    return anchors;
  }
  // Pauses use the shortest distance in the loaded road graph. Unlike ordinary
  // GPS matching, alternate roads, long detours and travel speed do not veto it.
  function pauseRoute(a: Candidate, b: Candidate) {
    if (a.edge === b.edge)
      return { steps: [{ edge: a.edge, from: a.t, to: b.t }] };
    type Arrival = {
      node: string;
      length: number;
      step: Step;
      previous?: Arrival;
    };
    const heap: Arrival[] = [],
      costs = new Map<string, number>();
    const push = (arrival: Arrival) => {
      if (arrival.length >= (costs.get(arrival.node) ?? Infinity)) return;
      costs.set(arrival.node, arrival.length);
      let i = heap.length;
      heap.push(arrival);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heap[parent].length <= arrival.length) break;
        heap[i] = heap[parent];
        i = parent;
      }
      heap[i] = arrival;
    };
    const pop = () => {
      const first = heap[0],
        last = heap.pop()!;
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1;
          if (
            child + 1 < heap.length &&
            heap[child + 1].length < heap[child].length
          )
            child++;
          if (last.length <= heap[child].length) break;
          heap[i] = heap[child];
          i = child;
        }
        heap[i] = last;
      }
      return first;
    };
    const first = edges[a.edge],
      last = edges[b.edge];
    push({
      node: first.u,
      length: a.t * first.length,
      step: { edge: a.edge, from: a.t, to: 0 },
    });
    push({
      node: first.v,
      length: (1 - a.t) * first.length,
      step: { edge: a.edge, from: a.t, to: 1 },
    });
    let best: { length: number; arrival: Arrival; end: 0 | 1 } | undefined;
    while (heap.length) {
      const current = pop();
      if (best && current.length >= best.length) break;
      if (current.length !== costs.get(current.node)) continue;
      const end =
        current.node === last.u ? 0 : current.node === last.v ? 1 : null;
      if (end !== null) {
        const length = current.length + Math.abs(b.t - end) * last.length;
        if (!best || length < best.length)
          best = { length, arrival: current, end };
      }
      for (const index of adjacency.get(current.node) ?? []) {
        if (index === a.edge || index === b.edge) continue;
        const e = edges[index],
          forward = e.u === current.node;
        push({
          node: forward ? e.v : e.u,
          length: current.length + e.length,
          previous: current,
          step: { edge: index, from: forward ? 0 : 1, to: forward ? 1 : 0 },
        });
      }
    }
    if (!best) return null;
    const steps: Step[] = [];
    for (
      let arrival: Arrival | undefined = best.arrival;
      arrival;
      arrival = arrival.previous
    )
      steps.push(arrival.step);
    steps.reverse();
    steps.push({ edge: b.edge, from: best.end, to: b.t });
    return { steps };
  }
  for (const ride of rides) {
    const plan = trackContinuity(ride.segments),
      anchors = new Map<(typeof plan.chunks)[number], Anchors>();
    for (const chunk of plan.chunks)
      anchors.set(
        chunk,
        matchSequence(
          chunk.map((p) => xy([p.lon, p.lat])),
          ride.id,
        ),
      );
    for (const gap of plan.gaps) {
      const start = gap.before.at(-1)!,
        end = gap.after[0];
      const a =
          anchors.get(gap.before)?.end ??
          candidates(xy([start.lon, start.lat]), [0, 0])[0],
        b =
          anchors.get(gap.after)?.start ??
          candidates(xy([end.lon, end.lat]), [0, 0])[0];
      if (!a || !b) continue;
      const route = pauseRoute(a, b);
      if (!route) continue;
      const coordinates: number[][] = [[start.lon, start.lat]];
      const append = (p: number[]) => {
        const last = coordinates.at(-1)!;
        if (Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-10)
          coordinates.push(p);
      };
      for (const step of route.steps) {
        const edge = edges[step.edge];
        append(ll(lerp(edge.a, edge.b, step.from)));
        append(ll(lerp(edge.a, edge.b, step.to)));
      }
      append([end.lon, end.lat]);
      if (coordinates.length > 1)
        pauseLinks.features.push({
          type: "Feature",
          properties: { rideId: ride.id },
          geometry: { type: "LineString", coordinates },
        });
      for (const step of route.steps)
        if (Math.abs(step.to - step.from) * edges[step.edge].length > 0.01)
          edges[step.edge].intervals.push({
            lo: Math.min(step.from, step.to),
            hi: Math.max(step.from, step.to),
            id: ride.id,
            inferred: true,
          });
    }
  }
  for (const edge of edges) {
    const events = edge.intervals
      .flatMap((i) => [
        { t: i.lo, id: i.id, delta: 1, inferred: !!i.inferred },
        { t: i.hi, id: i.id, delta: -1, inferred: !!i.inferred },
      ])
      .sort((a, b) => a.t - b.t);
    const active = new Map<string, number>(),
      inferred = new Map<string, number>();
    let previous = 0;
    for (let i = 0; i < events.length;) {
      const t = events[i].t;
      if (
        (t - previous) * edge.length > 0.01 &&
        (active.size || inferred.size)
      ) {
        const observedRideIds = [...active.keys()].sort(),
          inferredRideIds = [...inferred.keys()]
            .filter((id) => !active.has(id))
            .sort();
        const rideIds = [
            ...new Set([...observedRideIds, ...inferredRideIds]),
          ].sort(),
          coordinates = [
            ll(lerp(edge.a, edge.b, previous)),
            ll(lerp(edge.a, edge.b, t)),
          ],
          last = result.features.at(-1);
        const properties: RoadProperties = {
          count: [...active.values()].reduce(
            (total, passes) => total + passes,
            0,
          ),
          rideIds,
          ...(inferredRideIds.length
            ? { observedRideIds, inferredRideIds, inferred: !active.size }
            : {}),
        };
        if (
          last &&
          JSON.stringify(last.properties) === JSON.stringify(properties) &&
          distance(last.geometry.coordinates.at(-1) as XY, coordinates[0]) <
            1e-10
        )
          last.geometry.coordinates.push(coordinates[1]);
        else
          result.features.push({
            type: "Feature",
            properties,
            geometry: { type: "LineString", coordinates },
          });
      }
      while (i < events.length && Math.abs(events[i].t - t) < 1e-9) {
        const event = events[i++],
          target = event.inferred ? inferred : active,
          count = (target.get(event.id) ?? 0) + event.delta;
        if (count > 0) target.set(event.id, count);
        else target.delete(event.id);
      }
      previous = t;
    }
  }
  return result;
}
