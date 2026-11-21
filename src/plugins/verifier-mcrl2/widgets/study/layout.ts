// A layered graph layout, with no dependency, for the drawings of the Models tab: state machines (cycles,
// self-loops, parallel edges) and DAGs (a program's nodes and what each reads).
//
// The method is the classic one (Sugiyama, as in dagre and ELK), in four phases:
//  1. cycles are broken by a depth-first search in input order, reversing the edges into a node still on the
//     stack (an earlier node); layers come from the longest path, then each free node moves toward the side
//     where it has more edges; `opts.rank` fixes a node's layer;
//  2. layers are doubled, as dagre does for labels, so that every edge gets a virtual node per crossed layer,
//     its label a node of its own halfway; the order inside each layer starts
//     from a depth-first discovery order and is improved by barycenter sweeps with adjacent transpositions,
//     keeping a new order only when it strictly lowers the crossings; with `incremental`, each node is instead
//     inserted in input order at its best place and never moved, so a drawing that grows never reshuffles;
//  3. positions across the layers come from Brandes–Köpf: four median alignments, compacted into blocks and
//     balanced, so that long edges run straight and parents sit balanced over their children; a final
//     pool-adjacent-violators pass keeps every separation exactly;
//  4. edges become cubic Bézier curves through their virtual nodes, clipped to the node borders; parallel
//     edges and the two edges of a 2-cycle run apart through their own virtual nodes, edges inside one
//     layer (forced ranks) bow out along the flow, self-loops go nested on the side away from the flow.
// Everything is computed in an internal frame (f along the flow, c across it); the vertical direction is
// the same drawing with the two axes exchanged. Rounded rectangles are clipped as rectangles.

export interface GNode {
  id: string;
  width: number;
  height: number;
  shape?: "circle" | "rect" | "rounded";
}
export interface GEdge {
  id: string;
  from: string;
  to: string;
  labelWidth?: number;
  labelHeight?: number;
}
/** horizontal: layers from left to right (the default); vertical: from top to bottom. */
export type Direction = "horizontal" | "vertical";
export interface LayoutOptions {
  direction?: Direction;
  /** The least distance between the borders of two consecutive layers (default 56). */
  layerGap?: number;
  /** The least distance between two nodes of the same layer (default 28). */
  nodeGap?: number;
  /** The space around the whole drawing (default 20). */
  margin?: number;
  /** The order nodes are taken in, for the search and every tie (default: the input order). */
  order?: (a: string, b: string) => number;
  /**
   * Keep the order of what is drawn when nodes are appended: each node is inserted, in input order, at the
   * place of its layer with the fewest crossings, and never moved again. The default sweeps the layers
   * instead, which finds fewer crossings in dense graphs but may reorder nodes when one is added.
   */
  incremental?: boolean;
  /** A forced layer for some nodes (relative: the smallest layer used becomes 0). */
  rank?: Record<string, number>;
}
/** x, y: the node's centre. */
export interface PlacedNode extends GNode {
  x: number;
  y: number;
  layer: number;
}
export interface PlacedEdge {
  id: string;
  from: string;
  to: string;
  /** The SVG path, `M x y C …`, from the border of `from` to the border of `to`. */
  path: string;
  /** The path's points: the start, then three per cubic segment (two control points and its end). */
  points: [number, number][];
  /** The end point, and the curve's direction there in degrees, for an SVG rotate. */
  arrow: { x: number; y: number; angle: number };
  /** The centre of the edge's label, beside the curve's middle. */
  label: { x: number; y: number };
  /** Reversed to make the layers: drawn against the flow. */
  back: boolean;
  self: boolean;
}
export interface Layout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
}

type P = [number, number]; // [f, c] in the internal frame, [x, y] once out

interface Link {
  u: number;
  w: number;
}
interface VNode {
  layer: number;
  real: boolean;
  fs: number; // size along the flow
  lo: number; // extent across the flow, on the negative side
  hi: number; // and on the positive side
  up: Link[];
  down: Link[];
}
interface E {
  i: number; // the index in the input edges
  s: number;
  t: number;
}
interface Route {
  e: E;
  back: boolean;
  flat: boolean;
  chain: number[]; // in layered order: from the lower layer to the higher
  labelNode: number; // the virtual node carrying the label, or -1
}

const unit = (dx: number, dy: number): P => {
  const d = Math.hypot(dx, dy);
  return d > 1e-9 ? [dx / d, dy / d] : [1, 0];
};
const LOOP_OUT0 = unit(-0.6, -1);
const LOOP_OUT1 = unit(0.6, -1);

export function layout(
  nodes: GNode[],
  edges: GEdge[],
  opts: LayoutOptions = {},
): Layout {
  const horizontal = (opts.direction ?? "horizontal") === "horizontal";
  const layerGap = opts.layerGap ?? 56;
  const nodeGap = opts.nodeGap ?? 28;
  const margin = opts.margin ?? 20;
  const n = nodes.length;
  const nd = (v: number) => nodes[v]!;
  const ge = (i: number) => edges[i]!;

  // The node order every choice falls back on.
  const base = nodes.map((_, i) => i);
  if (opts.order) {
    const cmp = opts.order;
    base.sort((a, b) => cmp(nd(a).id, nd(b).id) || a - b);
  }
  const seq = new Array<number>(n).fill(0);
  base.forEach((v, k) => (seq[v] = k));
  const index = new Map<string, number>();
  nodes.forEach((x, i) => {
    if (!index.has(x.id)) index.set(x.id, i);
  });

  // Internal sizes: along the flow (f) and across it (c).
  const fsOf = (v: number) => (horizontal ? nd(v).width : nd(v).height);
  const csOf = (v: number) => (horizontal ? nd(v).height : nd(v).width);
  const labelF = (i: number) =>
    (horizontal ? ge(i).labelWidth : ge(i).labelHeight) ?? 0;
  const labelC = (i: number) =>
    (horizontal ? ge(i).labelHeight : ge(i).labelWidth) ?? 0;

  const all: E[] = [];
  edges.forEach((e, i) => {
    const s = index.get(e.from), t = index.get(e.to);
    if (s !== undefined && t !== undefined) all.push({ i, s, t });
  });
  const loops = all.filter((e) => e.s === e.t);
  const links = all.filter((e) => e.s !== e.t);

  // ── 1. Cycles and layers ────────────────────────────────────────────────────────────────────────────
  const out: number[][] = nodes.map(() => []);
  links.forEach((e, k) => out[e.s]!.push(k));
  const reversed = new Array<boolean>(links.length).fill(false);
  {
    const state = new Array<number>(n).fill(0); // 0 unseen, 1 on the stack, 2 done
    for (const r of base) {
      if (state[r]) continue;
      state[r] = 1;
      const stack: [number, number][] = [[r, 0]];
      while (stack.length) {
        const top = stack[stack.length - 1]!;
        const v = top[0];
        const outs = out[v]!;
        if (top[1] < outs.length) {
          const k = outs[top[1]++]!;
          const w = links[k]!.t;
          if (state[w] === 1) reversed[k] = true;
          else if (!state[w]) {
            state[w] = 1;
            stack.push([w, 0]);
          }
        } else {
          state[v] = 2;
          stack.pop();
        }
      }
    }
  }
  const dagIn: number[][] = nodes.map(() => []);
  const dagOut: number[][] = nodes.map(() => []);
  links.forEach((e, k) => {
    const [a, b] = reversed[k] ? [e.t, e.s] : [e.s, e.t];
    dagOut[a]!.push(b);
    dagIn[b]!.push(a);
  });
  const forced = nodes.map((x) => {
    const r = opts.rank?.[x.id];
    return typeof r === "number" && Number.isFinite(r)
      ? Math.round(r)
      : undefined;
  });
  const topo: number[] = [];
  {
    const deg = dagIn.map((l) => l.length);
    const queue = base.filter((v) => deg[v] === 0);
    for (let q = 0; q < queue.length; q++) {
      const v = queue[q]!;
      topo.push(v);
      for (const w of dagOut[v]!) if (--deg[w]! === 0) queue.push(w);
    }
  }
  const rank = new Array<number>(n).fill(0);
  const r = (v: number) => rank[v]!;
  for (const v of topo) {
    rank[v] = forced[v] ?? dagIn[v]!.reduce((m, u) => Math.max(m, r(u) + 1), 0);
  }
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (const v of topo) {
      if (forced[v] !== undefined) continue;
      const lo = dagIn[v]!.reduce((m, u) => Math.max(m, r(u) + 1), -Infinity);
      const hi = dagOut[v]!.reduce((m, u) => Math.min(m, r(u) - 1), Infinity);
      const d = dagIn[v]!.length - dagOut[v]!.length;
      const want = d > 0 ? lo : d < 0 ? hi : r(v);
      if (Number.isFinite(want) && want !== r(v) && want >= lo && want <= hi) {
        rank[v] = want;
        moved = true;
      }
    }
    if (!moved) break;
  }
  if (n) {
    const min = Math.min(...rank);
    for (let v = 0; v < n; v++) rank[v] = r(v) - min;
  }
  // Every layer gets an intermediate one (as dagre does for labels), so that every edge has a virtual node
  // halfway: its label is a node there, which takes part in the order and the spacing and never sits on a
  // node, and parallel edges or the two edges of a 2-cycle run apart.
  const lr = (v: number) => r(v) * 2;
  const layerCount = n ? Math.max(...rank) * 2 + 1 : 0;

  // ── 2. Virtual nodes and order ─────────────────────────────────────────────────────────────────────
  const V: VNode[] = nodes.map((_, v) => ({
    layer: lr(v),
    real: true,
    fs: fsOf(v),
    lo: csOf(v) / 2,
    hi: csOf(v) / 2,
    up: [],
    down: [],
  }));
  const vn = (v: number) => V[v]!;
  const routes: Route[] = [];
  for (const e of links) {
    const rs = lr(e.s), rt = lr(e.t);
    if (rs === rt) {
      routes.push({
        e,
        back: false,
        flat: true,
        chain: [e.s, e.t],
        labelNode: -1,
      });
      continue;
    }
    const back = rs > rt;
    const [a, b] = back ? [e.t, e.s] : [e.s, e.t];
    const span = Math.abs(rt - rs);
    const lf = labelF(e.i), lc = labelC(e.i);
    // the label's node: in an intermediate layer, near the middle
    const labelAt = lf > 0 || lc > 0 ? 2 * Math.floor((span - 2) / 4) : -1;
    const chain = [a];
    let labelNode = -1;
    for (let k = 0; k < span - 1; k++) {
      const x: VNode = {
        layer: lr(a) + 1 + k,
        real: false,
        fs: 0,
        lo: 0,
        hi: 0,
        up: [],
        down: [],
      };
      if (k === labelAt) {
        x.fs = lf;
        x.lo = lc + 8;
        labelNode = V.length;
      }
      chain.push(V.length);
      V.push(x);
    }
    chain.push(b);
    for (let k = 0; k + 1 < chain.length; k++) {
      const u = chain[k]!, w = chain[k + 1]!;
      const virtuals = (vn(u).real ? 0 : 1) + (vn(w).real ? 0 : 1);
      const wt = virtuals === 2 ? 8 : virtuals === 1 ? 2 : 1;
      vn(u).down.push({ u: w, w: wt });
      vn(w).up.push({ u, w: wt });
    }
    routes.push({ e, back, flat: false, chain, labelNode });
  }

  const shapeOf = (v: number) => nd(v).shape ?? "rect";
  // The point where the ray from the node's centre toward a point leaves its border.
  const border = (v: number, center: P, toward: P): P => {
    const a = fsOf(v) / 2, b = csOf(v) / 2;
    let dx = toward[0] - center[0], dy = toward[1] - center[1];
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) [dx, dy] = [1, 0];
    if (a <= 0 || b <= 0) return [center[0], center[1]];
    const t = shapeOf(v) === "circle"
      ? 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2)
      : Math.min(
        dx ? a / Math.abs(dx) : Infinity,
        dy ? b / Math.abs(dy) : Infinity,
      );
    return [center[0] + dx * t, center[1] + dy * t];
  };
  // The k-th self-loop of a node: one cubic on the negative side across the flow, nested by k.
  const loopGeom = (v: number, k: number, center: P): P[] => {
    const fs = fsOf(v), cs = csOf(v);
    const L = (Math.max(22, 0.5 * Math.min(fs, cs)) + 14 * k) * 1.3;
    const spread = 0.35 * (1 + k * 0.4) * Math.max(fs, 1);
    const p0 = border(v, center, [center[0] - spread, center[1] - cs]);
    const p1 = border(v, center, [center[0] + spread, center[1] - cs]);
    return [p0, [p0[0] + LOOP_OUT0[0] * L, p0[1] + LOOP_OUT0[1] * L], [
      p1[0] + LOOP_OUT1[0] * L,
      p1[1] + LOOP_OUT1[1] * L,
    ], p1];
  };
  {
    const k = new Array<number>(n).fill(0);
    for (const e of loops) {
      const g = loopGeom(e.s, k[e.s]!, [0, 0]);
      k[e.s] = k[e.s]! + 1;
      const reach = -Math.min(...g.map((p) => p[1])) + labelC(e.i) + 6;
      vn(e.s).lo = Math.max(vn(e.s).lo, reach);
    }
  }

  const layers: number[][] = Array.from({ length: layerCount }, () => []);
  const lay = (l: number) => layers[l]!;
  const ord = new Array<number>(V.length).fill(0);
  const o = (v: number) => ord[v]!;
  const renumber = (L: number[]) => L.forEach((v, i) => (ord[v] = i));
  const incremental = opts.incremental ?? false;
  if (incremental) {
    // Insertion in the base order: each node, and the virtual nodes of the edges it completes, goes to the
    // slot of its layer with the fewest crossings against what is already placed, nearest to its neighbours.
    // What was placed never moves, so appending a node never reorders the others.
    const placedV = new Array<boolean>(V.length).fill(false);
    const insert = (x: number) => {
      const l = vn(x).layer;
      const L = lay(l);
      const mine = [...vn(x).up, ...vn(x).down].filter((d) => placedV[d.u]);
      const cost = new Array<number>(L.length + 2).fill(0); // a difference array over the slots 0..L.length
      for (const d of mine) {
        const p = o(d.u), nl = vn(d.u).layer;
        L.forEach((y, j) => {
          for (const e of nl < l ? vn(y).up : vn(y).down) {
            if (!placedV[e.u]) continue;
            const q = o(e.u);
            if (q > p) { // crosses when x is placed after y
              cost[j + 1] = cost[j + 1]! + d.w * e.w;
            } else if (q < p) { // crosses when x is placed before y
              cost[0] = cost[0]! + d.w * e.w;
              cost[j + 1] = cost[j + 1]! - d.w * e.w;
            }
          }
        });
      }
      // the slot the neighbours point to: after every node whose placed neighbours lie before them on average
      const mean = (ds: Link[]) => {
        const ps = ds.filter((d) => placedV[d.u]).map((d) =>
          o(d.u) / Math.max(lay(vn(d.u).layer).length, 1)
        );
        return ps.length
          ? ps.reduce((a, b) => a + b, 0) / ps.length
          : undefined;
      };
      const mx = mean(mine);
      let target = L.length;
      if (mx !== undefined) {
        target = 0;
        L.forEach((y, j) => {
          const my = mean([...vn(y).up, ...vn(y).down]);
          if (my !== undefined && my <= mx) target = j + 1;
        });
      }
      let best = -1, bestCost = Infinity, run = 0;
      for (let s = 0; s <= L.length; s++) {
        run += cost[s]!;
        if (
          run < bestCost ||
          (run === bestCost && Math.abs(s - target) <= Math.abs(best - target))
        ) {
          best = s;
          bestCost = run;
        }
      }
      L.splice(best, 0, x);
      renumber(L);
      placedV[x] = true;
    };
    const byNode: Route[][] = nodes.map(() => []);
    for (const rt of routes) {
      if (rt.flat) continue;
      byNode[rt.e.s]!.push(rt);
      byNode[rt.e.t]!.push(rt);
    }
    const routed = new Set<Route>();
    for (const v of base) {
      for (const rt of byNode[v]!) {
        const other = rt.e.s === v ? rt.e.t : rt.e.s;
        if (routed.has(rt) || !placedV[other]) continue;
        routed.add(rt);
        // the virtual nodes, walking from the placed end toward v
        const inner = rt.chain.slice(1, -1);
        for (const x of rt.chain[0] === v ? inner.reverse() : inner) insert(x);
      }
      insert(v);
    }
  } else {
    // depth-first discovery order, from the nodes by layer then by the base order
    const seen = new Array<boolean>(V.length).fill(false);
    const roots = base.slice().sort((a, b) => r(a) - r(b) || seq[a]! - seq[b]!);
    for (const root of roots) {
      if (seen[root]) continue;
      seen[root] = true;
      lay(vn(root).layer).push(root);
      const stack: [number, number][] = [[root, 0]];
      while (stack.length) {
        const top = stack[stack.length - 1]!;
        const ds = vn(top[0]).down;
        if (top[1] >= ds.length) {
          stack.pop();
          continue;
        }
        const u = ds[top[1]++]!.u;
        if (seen[u]) continue;
        seen[u] = true;
        lay(vn(u).layer).push(u);
        stack.push([u, 0]);
      }
    }
    layers.forEach(renumber);
  }

  const crossBetween = (l: number): number => {
    const segs: [number, number, number][] = [];
    for (const u of lay(l)) {
      for (const d of vn(u).down) segs.push([o(u), o(d.u), d.w]);
    }
    segs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const size = lay(l + 1).length;
    const tree = new Array<number>(size + 1).fill(0); // a Fenwick tree of the weights by lower position
    let total = 0, sum = 0;
    for (const [, b, w] of segs) {
      let le = 0;
      for (let i = b + 1; i > 0; i -= i & -i) le += tree[i]!;
      total += w * (sum - le);
      for (let i = b + 1; i <= size; i += i & -i) tree[i] = tree[i]! + w;
      sum += w;
    }
    return total;
  };
  const crossings = () => {
    let c = 0;
    for (let l = 0; l + 1 < layerCount; l++) c += crossBetween(l);
    return c;
  };
  const sortLayer = (l: number, fromUp: boolean) => {
    const L = lay(l);
    const near = (v: number) => (fromUp ? vn(v).up : vn(v).down);
    const keyed: { v: number; b: number; i: number }[] = [];
    L.forEach((v, i) => {
      let s = 0, ws = 0;
      for (const d of near(v)) {
        s += o(d.u) * d.w;
        ws += d.w;
      }
      if (ws) keyed.push({ v, b: s / ws, i });
    });
    keyed.sort((x, y) => x.b - y.b || x.i - y.i);
    // a node with no neighbour on that side keeps its place; the others are sorted around it
    let k = 0;
    const res = L.map((v) => (near(v).length ? keyed[k++]!.v : v));
    layers[l] = res;
    renumber(res);
  };
  const pairCross = (v: number, w: number) => {
    let c = 0;
    for (const a of vn(v).up) {
      for (const b of vn(w).up) if (o(a.u) > o(b.u)) c += a.w * b.w;
    }
    for (const a of vn(v).down) {
      for (const b of vn(w).down) if (o(a.u) > o(b.u)) c += a.w * b.w;
    }
    return c;
  };
  const transpose = () => {
    for (let round = 0; round < 6; round++) {
      let improved = false;
      for (const L of layers) {
        for (let i = 0; i + 1 < L.length; i++) {
          const v = L[i]!, w = L[i + 1]!;
          if (pairCross(w, v) < pairCross(v, w)) {
            L[i] = w;
            L[i + 1] = v;
            ord[w] = i;
            ord[v] = i + 1;
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
  };
  if (!incremental) {
    let bestC = crossings();
    let best = layers.map((L) => L.slice());
    let stale = 0;
    for (let it = 0; it < 24 && bestC > 0; it++) {
      if (it % 2 === 0) {
        for (let l = 1; l < layerCount; l++) sortLayer(l, true);
      } else for (let l = layerCount - 2; l >= 0; l--) sortLayer(l, false);
      transpose();
      const c = crossings();
      if (c < bestC) {
        bestC = c;
        best = layers.map((L) => L.slice());
        stale = 0;
      } else if (++stale >= 4) break;
    }
    best.forEach((L, l) => (layers[l] = L));
    layers.forEach(renumber);
  }

  // ── 3. Coordinates ─────────────────────────────────────────────────────────────────────────────────
  const C = new Array<number>(V.length).fill(0);
  const c = (v: number) => C[v]!;
  const sep = (a: number, b: number) =>
    vn(a).hi + vn(b).lo + (vn(a).real && vn(b).real ? nodeGap : nodeGap / 2);
  // Brandes–Köpf: four alignments (to the medians above or below, scanning from either side), each
  // compacted into blocks, aligned to the narrowest, and balanced as the mean of the two middle values.
  {
    const N = V.length;
    const conflicts = new Set<number>();
    const key = (a: number, b: number) => (a < b ? a * N + b : b * N + a);
    // type 1 conflicts: a segment between real nodes crossing an inner segment of a long edge
    for (let l = 1; l < layerCount; l++) {
      const prev = lay(l - 1), L = lay(l);
      let k0 = 0, scan = 0;
      L.forEach((v, i) => {
        const inner = vn(v).real
          ? undefined
          : vn(v).up.find((d) => !vn(d.u).real);
        const k1 = inner ? o(inner.u) : prev.length;
        if (inner || i === L.length - 1) {
          for (const s of L.slice(scan, i + 1)) {
            for (const d of vn(s).up) {
              const p = o(d.u);
              if ((p < k0 || k1 < p) && !(!vn(d.u).real && !vn(s).real)) {
                conflicts.add(key(d.u, s));
              }
            }
          }
          scan = i + 1;
          k0 = k1;
        }
      });
    }
    const runs: number[][] = [];
    for (const fromUp of [true, false]) {
      for (const fromLeft of [true, false]) {
        let order = fromUp ? layers : layers.slice().reverse();
        if (!fromLeft) order = order.map((L) => L.slice().reverse());
        const pos = new Array<number>(N).fill(0);
        const root = new Array<number>(N).fill(0).map((_, v) => v);
        const align = root.slice();
        for (const L of order) L.forEach((v, i) => (pos[v] = i));
        for (const L of order) {
          let last = -1;
          for (const v of L) {
            const ws = (fromUp ? vn(v).up : vn(v).down).map((d) => d.u).sort((
              a,
              b,
            ) => pos[a]! - pos[b]!);
            if (!ws.length) continue;
            const mp = (ws.length - 1) / 2;
            for (let i = Math.floor(mp); i <= Math.ceil(mp); i++) {
              const w = ws[i]!;
              if (
                align[v] === v && last < pos[w]! && !conflicts.has(key(v, w))
              ) {
                align[w] = v;
                align[v] = root[v] = root[w]!;
                last = pos[w]!;
              }
            }
          }
        }
        // compaction: blocks (by root) separated by the widest gap any of their pairs needs
        const gap = (u: number, v: number) =>
          // u before v in this scan
          (fromLeft ? vn(u).hi + vn(v).lo : vn(u).lo + vn(v).hi) +
          (vn(u).real && vn(v).real ? nodeGap : nodeGap / 2);
        const succ = new Map<number, Map<number, number>>();
        const indeg = new Array<number>(N).fill(0);
        for (const L of order) {
          for (let i = 1; i < L.length; i++) {
            const a = root[L[i - 1]!]!, b = root[L[i]!]!;
            const m = succ.get(a) ?? new Map<number, number>();
            if (!m.has(b)) indeg[b] = indeg[b]! + 1;
            m.set(b, Math.max(m.get(b) ?? 0, gap(L[i - 1]!, L[i]!)));
            succ.set(a, m);
          }
        }
        const roots = root.filter((x, v) => x === v);
        const topoB: number[] = roots.filter((v) => indeg[v] === 0);
        for (let q = 0; q < topoB.length; q++) {
          for (const b of succ.get(topoB[q]!)?.keys() ?? []) {
            if ((indeg[b] = indeg[b]! - 1) === 0) topoB.push(b);
          }
        }
        const xs = new Array<number>(N).fill(0);
        for (const a of topoB) {
          for (const [b, w] of succ.get(a) ?? []) {
            xs[b] = Math.max(xs[b]!, xs[a]! + w);
          }
        }
        for (let q = topoB.length - 1; q >= 0; q--) {
          const a = topoB[q]!;
          let min = Infinity;
          for (const [b, w] of succ.get(a) ?? []) {
            min = Math.min(min, xs[b]! - w);
          }
          if (min !== Infinity) xs[a] = Math.max(xs[a]!, min);
        }
        runs.push(root.map((x) => (fromLeft ? xs[x]! : -xs[x]!)));
      }
    }
    const span = (xs: number[]) => {
      let lo = Infinity, hi = -Infinity;
      xs.forEach((x, v) => {
        lo = Math.min(lo, x - vn(v).lo);
        hi = Math.max(hi, x + vn(v).hi);
      });
      return [lo, hi] as const;
    };
    const widths = runs.map((xs) => span(xs)[1] - span(xs)[0]);
    const narrow = runs[widths.indexOf(Math.min(...widths))]!;
    const [nlo, nhi] = span(narrow);
    runs.forEach((xs, k) => {
      const [lo, hi] = span(xs);
      const delta = k % 2 === 0 ? nlo - lo : nhi - hi; // runs 0 and 2 scan from the left
      for (let v = 0; v < N; v++) xs[v] = xs[v]! + delta;
    });
    for (let v = 0; v < N; v++) {
      const s = runs.map((xs) => xs[v]!).sort((a, b) => a - b);
      C[v] = N ? (s[1]! + s[2]!) / 2 : 0;
    }
  }
  // The balanced mean can bring two nodes too close: the nearest placement that keeps every separation.
  const place = (L: number[]) => {
    const m = L.length;
    if (!m) return;
    const off = new Array<number>(m).fill(0);
    for (let i = 1; i < m; i++) off[i] = off[i - 1]! + sep(L[i - 1]!, L[i]!);
    const blocks: { w: number; s: number; n: number }[] = [];
    L.forEach((v, i) => {
      const w = 1;
      blocks.push({ w, s: w * (c(v) - off[i]!), n: 1 });
      while (blocks.length > 1) {
        const p = blocks[blocks.length - 2]!, q = blocks[blocks.length - 1]!;
        if (p.s / p.w <= q.s / q.w) break;
        blocks.pop();
        p.w += q.w;
        p.s += q.s;
        p.n += q.n;
      }
    });
    let i = 0;
    for (const b of blocks) {
      for (let j = 0; j < b.n; j++, i++) C[L[i]!] = b.s / b.w + off[i]!;
    }
  };
  layers.forEach(place);

  const F = new Array<number>(V.length).fill(0);
  {
    const size = layers.map((L) =>
      L.reduce((m, v) => Math.max(m, vn(v).fs), 0)
    );
    let f = 0;
    layers.forEach((L, l) => {
      if (l) f += size[l - 1]! / 2 + layerGap / 2 + size[l]! / 2;
      for (const v of L) F[v] = f;
    });
  }
  const at = (v: number): P => [F[v]!, C[v]!];

  // ── 4. Edges ───────────────────────────────────────────────────────────────────────────────────────
  interface Drawn {
    i: number;
    pts: P[];
    label: P;
    back: boolean;
    self: boolean;
  }
  const drawn: Drawn[] = [];
  // A smooth curve through the anchors: a cubic per pair, with the given tangents (by default the
  // direction of the first or the last segment) and handles along the flow at the virtual nodes.
  const curve = (
    anchors: P[],
    tangents: (P | null)[],
    flowAligned: boolean[],
  ): P[] => {
    const A = (k: number) => anchors[k]!;
    const m = anchors.length;
    const tan = anchors.map((_, k): P =>
      tangents[k] ??
        (k === 0
          ? unit(A(1)[0] - A(0)[0], A(1)[1] - A(0)[1])
          : unit(A(k)[0] - A(k - 1)[0], A(k)[1] - A(k - 1)[1]))
    );
    const pts: P[] = [A(0)];
    for (let k = 0; k + 1 < m; k++) {
      const a = A(k), b = A(k + 1), ta = tan[k]!, tb = tan[k + 1]!;
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const h0 = flowAligned[k] ? Math.abs(b[0] - a[0]) * 0.5 : d * 0.4;
      const h1 = flowAligned[k + 1] ? Math.abs(b[0] - a[0]) * 0.5 : d * 0.4;
      pts.push([a[0] + ta[0] * h0, a[1] + ta[1] * h0], [
        b[0] - tb[0] * h1,
        b[1] - tb[1] * h1,
      ], b);
    }
    return pts;
  };
  // How far a label's centre goes from the curve along the normal, for its box to clear the curve.
  const clearance = (tangent: P, i: number): number =>
    Math.abs(tangent[1]) * labelF(i) / 2 +
    Math.abs(tangent[0]) * labelC(i) / 2 + 4;
  const bez = (p: P[], k: number, t: number): { at: P; tan: P } => {
    const a = p[3 * k]!,
      b = p[3 * k + 1]!,
      cc = p[3 * k + 2]!,
      d = p[3 * k + 3]!;
    const s = 1 - t;
    const pt = (j: 0 | 1) =>
      s * s * s * a[j] + 3 * s * s * t * b[j] + 3 * s * t * t * cc[j] +
      t * t * t * d[j];
    const tg = (j: 0 | 1) =>
      3 * s * s * (b[j] - a[j]) + 6 * s * t * (cc[j] - b[j]) +
      3 * t * t * (d[j] - cc[j]);
    return { at: [pt(0), pt(1)], tan: unit(tg(0), tg(1)) };
  };

  // How many edges join the same two nodes across layers.
  const pairKey = (rt: Route) =>
    `${Math.min(rt.e.s, rt.e.t)} ${Math.max(rt.e.s, rt.e.t)}`;
  const pairs = new Map<string, number>();
  for (const rt of routes) {
    if (!rt.flat) pairs.set(pairKey(rt), (pairs.get(pairKey(rt)) ?? 0) + 1);
  }
  // Edges between two nodes of the same layer (from forced ranks) bow out along the flow, nested.
  const fan = new Map<Route, number>();
  {
    const bundles = new Map<string, Route[]>();
    for (const rt of routes) {
      if (!rt.flat) continue;
      const key = `${Math.min(rt.e.s, rt.e.t)} ${Math.max(rt.e.s, rt.e.t)}`;
      bundles.set(key, [...(bundles.get(key) ?? []), rt]);
    }
    for (const group of bundles.values()) {
      const spacing = Math.max(18, ...group.map((rt) => labelC(rt.e.i) + 10));
      group.forEach((rt, k) => fan.set(rt, k * spacing));
    }
  }

  for (const rt of routes) {
    const { s, t, i } = rt.e;
    const cs = at(s), ct = at(t);
    if (rt.flat) {
      // two nodes of one layer: a bow out along the flow
      const bow = Math.max(vn(s).fs, vn(t).fs) / 2 + 22 + (fan.get(rt) ?? 0);
      const M: P = [(cs[0] + ct[0]) / 2 + bow, (cs[1] + ct[1]) / 2];
      const start = border(s, cs, M), end = border(t, ct, M);
      const chord = unit(end[0] - start[0], end[1] - start[1]);
      const pts = curve([start, M, end], [null, chord, null], [
        false,
        false,
        false,
      ]);
      drawn.push({
        i,
        pts,
        label: [M[0] + clearance(chord, i), M[1]],
        back: false,
        self: false,
      });
      continue;
    }
    // through the virtual nodes, with handles along the flow there; a virtual node of an intermediate layer
    // only where it carries the label or keeps the edge apart from another between the same two nodes
    const chain = rt.back ? rt.chain.slice().reverse() : rt.chain;
    const keep = (v: number) =>
      vn(v).layer % 2 === 0 || v === rt.labelNode ||
      (pairs.get(pairKey(rt)) ?? 0) > 1;
    const inner = chain.slice(1, -1).filter(keep).map(at);
    const start = border(s, cs, inner[0] ?? ct),
      end = border(t, ct, inner[inner.length - 1] ?? cs);
    const anchors = [start, ...inner, end];
    const last = anchors.length - 1;
    const dir = rt.back ? -1 : 1;
    const pts = curve(
      anchors,
      anchors.map((
        _,
        k,
      ): P | null => (k === 0 || k === last ? null : [dir, 0])),
      anchors.map((_, k) => k > 0 && k < last),
    );
    let label: P;
    if (rt.labelNode >= 0) {
      const lp = at(rt.labelNode);
      label = [lp[0], lp[1] - labelC(i) / 2 - 4];
    } else {
      // the curve's middle, on the negative side across the flow
      const segs = (pts.length - 1) / 3;
      const { at: mid, tan } = segs % 2
        ? bez(pts, (segs - 1) / 2, 0.5)
        : bez(pts, segs / 2, 0);
      let nrm: P = [-tan[1], tan[0]];
      if (nrm[1] > 0) nrm = [-nrm[0], -nrm[1]];
      const d = clearance(tan, i);
      label = [mid[0] + nrm[0] * d, mid[1] + nrm[1] * d];
    }
    drawn.push({ i, pts, label, back: rt.back, self: false });
  }
  {
    const k = new Array<number>(n).fill(0);
    for (const e of loops) {
      const g = loopGeom(e.s, k[e.s]!, at(e.s));
      k[e.s] = k[e.s]! + 1;
      const top = bez(g, 0, 0.5).at;
      drawn.push({
        i: e.i,
        pts: g,
        label: [top[0], top[1] - labelC(e.i) / 2 - 4],
        back: false,
        self: true,
      });
    }
  }
  drawn.sort((a, b) => a.i - b.i);

  // ── Output frame, bounds and margin ────────────────────────────────────────────────────────────────
  const T = (p: P): P => (horizontal ? [p[0], p[1]] : [p[1], p[0]]);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  };
  const placed = nodes.map((x, v) => {
    const p = T(at(v));
    grow(
      p[0] - x.width / 2,
      p[1] - x.height / 2,
      p[0] + x.width / 2,
      p[1] + x.height / 2,
    );
    return p;
  });
  const outEdges = drawn.map((d) => {
    const pts = d.pts.map(T);
    for (const [x, y] of pts) grow(x, y, x, y);
    const label = T(d.label);
    const lw = ge(d.i).labelWidth ?? 0, lh = ge(d.i).labelHeight ?? 0;
    grow(
      label[0] - lw / 2,
      label[1] - lh / 2,
      label[0] + lw / 2,
      label[1] + lh / 2,
    );
    return { d, pts, label };
  });
  if (!Number.isFinite(minX)) {
    minX =
      minY =
      maxX =
      maxY =
        0;
  }
  const dx = margin - minX, dy = margin - minY;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const fmt = (p: P) => `${r2(p[0])} ${r2(p[1])}`;

  return {
    nodes: nodes.map((x, v) => ({
      ...x,
      x: placed[v]![0] + dx,
      y: placed[v]![1] + dy,
      layer: r(v),
    })),
    edges: outEdges.map(({ d, pts, label }) => {
      const e = ge(d.i);
      const p = pts.map(([x, y]): [number, number] => [x + dx, y + dy]);
      let path = `M ${fmt(p[0]!)}`;
      for (let k = 1; k + 2 < p.length; k += 3) {
        path += ` C ${fmt(p[k]!)}, ${fmt(p[k + 1]!)}, ${fmt(p[k + 2]!)}`;
      }
      const end = p[p.length - 1]!;
      const prev = p[p.length - 2]!;
      return {
        id: e.id,
        from: e.from,
        to: e.to,
        path,
        points: p,
        arrow: {
          x: end[0],
          y: end[1],
          angle: (Math.atan2(end[1] - prev[1], end[0] - prev[0]) * 180) /
            Math.PI,
        },
        label: { x: label[0] + dx, y: label[1] + dy },
        back: d.back,
        self: d.self,
      };
    }),
    width: maxX - minX + 2 * margin,
    height: maxY - minY + 2 * margin,
  };
}
