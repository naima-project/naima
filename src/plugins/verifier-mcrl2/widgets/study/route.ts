// The edges of a laid-out graph drawn as a person would draw them: every edge leaves its
// node on the side the flow goes and enters the next on the side the flow comes from, as a smooth curve whose
// tangents follow the flow at both ends and at every bend, so arrows read as curves, never as stiff diagonals; and a
// fan of the steps possible now drawn as a tidy list beside the node they leave from, whatever the flow. Back edges and
// loops keep the curves the layout gave them. Plain geometry, tested without a page.

import type { Direction, Layout, PlacedEdge, PlacedNode } from "./layout.ts";

type P = [number, number];

export interface RouteOptions {
  /** Nodes drawn as a list beside `fanFrom`: the steps possible now, in this order. */
  fan?: readonly string[];
  fanFrom?: string | null;
  /** How wide each fanned node's words are, to keep them inside the drawing. */
  fanWidth?: (id: string) => number;
  /** Nodes that must not sit in the fan's way (the roads left): moved below the fan when they would. */
  avoid?: readonly string[];
  /** How wide each edge's label is, to set it beside a vertical curve. */
  labelWidth?: (id: string) => number;
  margin?: number;
}

/** The SVG path through a start and cubic segments (three points each). */
export function pathOf(p: readonly P[]): string {
  if (p.length === 0) return "";
  let d = `M ${p[0]![0]},${p[0]![1]}`;
  for (let i = 1; i + 2 < p.length; i += 3) {
    d += ` C ${p[i]![0]},${p[i]![1]} ${p[i + 1]![0]},${p[i + 1]![1]} ${p[i + 2]![0]},${p[i + 2]![1]}`;
  }
  return d;
}

/** The arrowhead at a path's end, along its last segment's tangent. */
export function arrowOf(
  p: readonly P[],
): { x: number; y: number; angle: number } {
  const e = p[p.length - 1]!;
  let k = p.length - 2;
  while (k > 0 && Math.hypot(p[k]![0] - e[0], p[k]![1] - e[1]) < 1e-6) k--;
  const b = p[k] ?? e;
  return {
    x: e[0],
    y: e[1],
    angle: (Math.atan2(e[1] - b[1], e[0] - b[0]) * 180) / Math.PI,
  };
}

const bez = (a: P, b: P, c: P, d: P, t: number): P => {
  const u = 1 - t;
  return [
    u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] +
    t * t * t * d[0],
    u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] +
    t * t * t * d[1],
  ];
};

/** A smooth curve through anchors whose tangents follow the flow: horizontal handles for a horizontal flow. */
export function flowCurve(anchors: readonly P[], dir: Direction): P[] {
  const out: P[] = [anchors[0]!];
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    if (dir === "horizontal") {
      const h = Math.max(12, Math.abs(b[0] - a[0]) / 2);
      const s = Math.sign(b[0] - a[0]) || 1;
      out.push([a[0] + s * h, a[1]], [b[0] - s * h, b[1]], b);
    } else {
      const h = Math.max(12, Math.abs(b[1] - a[1]) / 2);
      const s = Math.sign(b[1] - a[1]) || 1;
      out.push([a[0], a[1] + s * h], [b[0], b[1] - s * h], b);
    }
  }
  return out;
}

/** Where an edge leaves a node, or enters it, on the flow's side. */
const exit = (
  n: PlacedNode,
  dir: Direction,
): P => (dir === "horizontal" ? [n.x + n.width / 2, n.y] : [n.x, n.y + n.height / 2]);
const entry = (
  n: PlacedNode,
  dir: Direction,
): P => (dir === "horizontal" ? [n.x - n.width / 2, n.y] : [n.x, n.y - n.height / 2]);

export function route(
  l: Layout,
  dir: Direction,
  opts: RouteOptions = {},
): Layout {
  const margin = opts.margin ?? 20;
  const nodes = l.nodes.map((n) => ({ ...n }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // The fan: the steps possible now, a list beside the node they leave from, one row apart.
  const fan = new Set(opts.fan ?? []);
  const from = opts.fanFrom ? byId.get(opts.fanFrom) : undefined;
  if (from && fan.size > 0) {
    const ids = (opts.fan ?? []).filter((id) => byId.has(id));
    const ROW = 28;
    ids.forEach((id, i) => {
      const n = byId.get(id)!;
      if (dir === "horizontal") {
        n.x = from.x + from.width / 2 + 110;
        n.y = from.y + (i - (ids.length - 1) / 2) * ROW;
      } else {
        n.x = from.x + 40;
        n.y = from.y + from.height / 2 + 54 + i * ROW;
      }
    });
  }

  // The roads left keep clear of the fan: a node in the fan's box goes below it, with everything after it on its road.
  const moved = new Set<string>();
  if (from && fan.size > 0) {
    const fanNodes = [...fan].map((id) => byId.get(id)).filter((
      n,
    ): n is PlacedNode => !!n);
    if (fanNodes.length > 0) {
      const top = Math.min(...fanNodes.map((n) => n.y - n.height / 2)) - 16;
      const bottom = Math.max(...fanNodes.map((n) => n.y + n.height / 2)) + 28;
      const left = Math.min(...fanNodes.map((n) => n.x - n.width / 2)) - 24;
      const right = Math.max(...fanNodes.map((n) => n.x + n.width / 2 + 12 + (opts.fanWidth?.(n.id) ?? 0))) + 24;
      for (const id of opts.avoid ?? []) {
        const n = byId.get(id);
        if (!n || fan.has(id)) {
          continue;
        }
        // Ahead of the fan's start along the flow: its road would cross the list, so it goes below it.
        const inX = dir === "horizontal"
          ? n.x + n.width / 2 >= left
          : n.x + n.width / 2 >= left && n.x - n.width / 2 <= right;
        const inY = n.y + n.height / 2 >= top && n.y - n.height / 2 <= bottom;
        if (inX && (inY || n.y > top)) {
          const by = bottom - (n.y - n.height / 2) + 12;
          if (by > 0) {
            n.y += by;
            moved.add(id);
          }
        }
      }
    }
  }

  const edges: PlacedEdge[] = l.edges.map((e) => {
    if (e.self && moved.has(e.from)) {
      const n = byId.get(e.from)!;
      const o = l.nodes.find((x) => x.id === e.from)!;
      const dy = n.y - o.y;
      const points = e.points.map((p): P => [p[0], p[1] + dy]);
      return {
        ...e,
        points,
        path: pathOf(points),
        arrow: arrowOf(points),
        label: { x: e.label.x, y: e.label.y + dy },
      };
    }
    if (e.back || e.self) return e;
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return e;
    const fanned = fan.has(e.to);
    // The layout's bends: the ends of its cubic segments, between the first and the last point.
    const bends: P[] = [];
    if (!fanned && !moved.has(e.from) && !moved.has(e.to)) {
      for (let i = 3; i < e.points.length - 1; i += 3) {
        bends.push(e.points[i]!);
      }
    }
    const start = exit(a, dir);
    const end: P = fanned && dir === "vertical" ? [b.x - b.width / 2, b.y] : entry(b, dir);
    const points = fanned && dir === "vertical"
      ? [
        start,
        [start[0], (start[1] + end[1]) / 2] as P,
        [start[0], end[1]] as P,
        end,
      ]
      : flowCurve([start, ...bends, end], dir);
    // The label at the middle of the middle segment, set off the curve.
    const k = Math.max(0, Math.floor((points.length - 1) / 3 / 2)) * 3;
    const m = points.length >= 4 ? bez(points[k]!, points[k + 1]!, points[k + 2]!, points[k + 3]!, 0.5) : start;
    const w = opts.labelWidth?.(e.id) ?? 0;
    const label = dir === "horizontal" ? { x: m[0], y: m[1] - 8 } : { x: m[0] - 10 - w / 2, y: m[1] + 4 };
    return {
      ...e,
      points,
      path: pathOf(points),
      arrow: arrowOf(points),
      label,
    };
  });

  // The drawing's bounds: every node, its words when fanned, every curve; shifted to start at the margin.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const take = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const n of nodes) {
    take(n.x - n.width / 2, n.y - n.height / 2);
    take(
      n.x + n.width / 2 +
        (fan.has(n.id) ? 12 + (opts.fanWidth?.(n.id) ?? 0) : 0),
      n.y + n.height / 2,
    );
  }
  for (const e of edges) {
    for (const p of e.points) take(p[0], p[1]);
    const w = opts.labelWidth?.(e.id) ?? 0;
    take(e.label.x - w / 2, e.label.y - 12);
    take(e.label.x + w / 2, e.label.y + 4);
  }
  if (!Number.isFinite(x0)) return l;
  const dx = margin - x0;
  const dy = margin - y0;
  const shift = (p: P): P => [p[0] + dx, p[1] + dy];
  return {
    width: x1 - x0 + 2 * margin,
    height: y1 - y0 + 2 * margin,
    nodes: nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })),
    edges: edges.map((e) => {
      const points = e.points.map(shift);
      return {
        ...e,
        points,
        path: pathOf(points),
        arrow: arrowOf(points),
        label: { x: e.label.x + dx, y: e.label.y + dy },
      };
    }),
  };
}
