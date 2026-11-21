// More ways to draw a graph than in layers: around a centre (radial), as springs pulling
// linked nodes together and pushing the others apart (force-directed), or in rows (grid). Each starts from the layered
// layout, so the order a reader already knows is kept, and returns the same shape of layout, with curved edges that
// leave and enter on the nodes' borders. These are a drawing's own coordinates, scaled by the browser with the
// drawing's viewBox; no page layout is computed here. Deterministic: the same graph is drawn the same way every time.

import type { Layout, PlacedEdge, PlacedNode } from "./layout.ts";
import { arrowOf, pathOf } from "./route.ts";

type P = [number, number];

export type Algorithm = "layered" | "radial" | "force" | "grid";

/** The graph again, drawn by another algorithm from its layered layout. */
export function redraw(
  l: Layout,
  algorithm: Exclude<Algorithm, "layered">,
  opts: { gap?: number; margin?: number } = {},
): Layout {
  const gap = opts.gap ?? 90;
  const margin = opts.margin ?? 24;
  const nodes = l.nodes.map((n) => ({ ...n }));
  if (nodes.length === 0) return l;
  if (algorithm === "radial") radial(nodes, gap);
  else if (algorithm === "grid") grid(nodes, gap);
  else force(nodes, l.edges, gap);
  return bounded(nodes, edgesFor(nodes, l.edges), margin);
}

/** Layers on rings around the first layer's centre, each node at its place in its layer's order. */
function radial(nodes: PlacedNode[], gap: number) {
  const layers = new Map<number, PlacedNode[]>();
  for (const n of nodes) {
    layers.set(n.layer, [...(layers.get(n.layer) ?? []), n]);
  }
  const ordered = [...layers.entries()].sort((a, b) => a[0] - b[0]);
  ordered.forEach(([, ns], ring) => {
    ns.sort((a, b) => a.x + a.y - (b.x + b.y));
    const r = ring === 0 && ns.length === 1 ? 0 : (ring + 1) * gap;
    ns.forEach((n, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / ns.length + ring * 0.35;
      n.x = r * Math.cos(a);
      n.y = r * Math.sin(a);
    });
  });
}

/** In rows, in reading order, as many columns as make the drawing about square. */
function grid(nodes: PlacedNode[], gap: number) {
  const order = [...nodes].sort((a, b) => a.layer - b.layer || a.x + a.y - (b.x + b.y));
  const cols = Math.max(1, Math.ceil(Math.sqrt(order.length)));
  order.forEach((n, i) => {
    n.x = (i % cols) * gap * 1.4;
    n.y = Math.floor(i / cols) * gap;
  });
}

/** Springs: linked nodes pull together, every pair pushes apart; a fixed number of cooling steps from the layered start. */
function force(nodes: PlacedNode[], edges: readonly PlacedEdge[], gap: number) {
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const links = edges.filter((e) => !e.self).map((e) => [idx.get(e.from)!, idx.get(e.to)!] as const).filter(([a, b]) =>
    a !== undefined && b !== undefined
  );
  const k = gap;
  let t = gap;
  for (let step = 0; step < 300; step++) {
    const d = nodes.map(() => [0, 0] as P);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[i]!.x - nodes[j]!.x;
        let dy = nodes[i]!.y - nodes[j]!.y;
        if (dx === 0 && dy === 0) {
          dx = 0.01 * (i - j);
          dy = 0.01;
        }
        const dist = Math.max(1, Math.hypot(dx, dy));
        const f = (k * k) / dist;
        d[i]![0] += (dx / dist) * f;
        d[i]![1] += (dy / dist) * f;
        d[j]![0] -= (dx / dist) * f;
        d[j]![1] -= (dy / dist) * f;
      }
    }
    for (const [a, b] of links) {
      const dx = nodes[a]!.x - nodes[b]!.x;
      const dy = nodes[a]!.y - nodes[b]!.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const f = (dist * dist) / k;
      d[a]![0] -= (dx / dist) * f;
      d[a]![1] -= (dy / dist) * f;
      d[b]![0] += (dx / dist) * f;
      d[b]![1] += (dy / dist) * f;
    }
    nodes.forEach((n, i) => {
      const [dx, dy] = d[i]!;
      const len = Math.max(1e-9, Math.hypot(dx, dy));
      n.x += (dx / len) * Math.min(len, t);
      n.y += (dy / len) * Math.min(len, t);
    });
    t = Math.max(0.5, t * 0.97);
  }
}

/** Edges as gentle arcs from border to border; a loop above its node. */
function edgesFor(
  nodes: readonly PlacedNode[],
  edges: readonly PlacedEdge[],
): PlacedEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges.map((e) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return e;
    if (e.self || a === b) {
      const r = a.height / 2;
      const p: P[] = [[a.x - 6, a.y - r], [a.x - 26, a.y - r - 34], [
        a.x + 26,
        a.y - r - 34,
      ], [a.x + 6, a.y - r]];
      return {
        ...e,
        points: p,
        path: pathOf(p),
        arrow: arrowOf(p),
        label: { x: a.x, y: a.y - r - 34 },
      };
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / dist;
    const uy = dy / dist;
    const ra = Math.min(a.width, a.height) / 2;
    const rb = Math.min(b.width, b.height) / 2;
    const s: P = [a.x + ux * ra, a.y + uy * ra];
    const t: P = [b.x - ux * rb, b.y - uy * rb];
    // A bend of a seventh of the distance, to the left of the way: two edges between the same nodes part.
    const bend = dist / 7;
    const nx = -uy * bend;
    const ny = ux * bend;
    const p: P[] = [s, [s[0] + dx / 3 + nx, s[1] + dy / 3 + ny], [
      t[0] - dx / 3 + nx,
      t[1] - dy / 3 + ny,
    ], t];
    return {
      ...e,
      points: p,
      path: pathOf(p),
      arrow: arrowOf(p),
      label: { x: (s[0] + t[0]) / 2 + nx, y: (s[1] + t[1]) / 2 + ny - 6 },
    };
  });
}

/** Shifted to start at the margin, its width and height covering every node and curve. */
function bounded(
  nodes: PlacedNode[],
  edges: PlacedEdge[],
  margin: number,
): Layout {
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
    take(n.x + n.width / 2, n.y + n.height / 2);
  }
  for (const e of edges) for (const p of e.points) take(p[0], p[1]);
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
