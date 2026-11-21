// A mosaic of cards (develop/models-tab.md §13): the window divided again and again, each piece a card, so the cards
// always tile the whole space, like a Mondrian canvas. It is only a tree: each division has a direction and a ratio,
// which the page draws as nested flex boxes (the ratio is each side's flex-grow), so the browser lays it out and no
// position or size is ever computed here. A card moved onto the edge of another divides that one; moved onto its middle,
// the two swap; closed, its space goes to its neighbour. Plain data, kept per study and tested without a page.

export type Tile = { card: string } | {
  dir: "row" | "col";
  ratio: number;
  a: Tile;
  b: Tile;
};

export interface Mosaic {
  root: Tile | null;
  /** Cards not shown, which can be opened again. */
  closed: string[];
  maximised: string | null;
}

export type Side = "left" | "right" | "top" | "bottom" | "center";

const MIN = 0.12;
const clamp = (r: number) => Math.max(MIN, Math.min(1 - MIN, r));
const isCard = (t: Tile): t is { card: string } => "card" in t;

/** Every card in the mosaic, in reading order. */
export function cardsOf(t: Tile | null): string[] {
  if (!t) return [];
  return isCard(t) ? [t.card] : [...cardsOf(t.a), ...cardsOf(t.b)];
}

const at = (t: Tile, path: string): Tile | null => {
  let cur: Tile = t;
  for (const c of path) {
    if (isCard(cur)) return null;
    cur = c === "a" ? cur.a : cur.b;
  }
  return cur;
};

const replaceAt = (t: Tile, path: string, f: (x: Tile) => Tile): Tile => {
  if (path === "") return f(t);
  if (isCard(t)) return t;
  return path[0] === "a"
    ? { ...t, a: replaceAt(t.a, path.slice(1), f) }
    : { ...t, b: replaceAt(t.b, path.slice(1), f) };
};

/** Sets a division's ratio: what its first side takes of its space. */
export function resize(m: Mosaic, path: string, ratio: number): Mosaic {
  if (!m.root || !at(m.root, path) || isCard(at(m.root, path)!)) return m;
  return {
    ...m,
    root: replaceAt(
      m.root,
      path,
      (x) => (isCard(x) ? x : { ...x, ratio: clamp(ratio) }),
    ),
  };
}

const without = (t: Tile, id: string): Tile | null => {
  if (isCard(t)) return t.card === id ? null : t;
  const a = without(t.a, id);
  const b = without(t.b, id);
  if (!a) return b;
  if (!b) return a;
  return { ...t, a, b };
};

/** Closes a card: its neighbour takes its space. */
export function close(m: Mosaic, id: string): Mosaic {
  if (!m.root || !cardsOf(m.root).includes(id)) return m;
  return {
    root: without(m.root, id),
    closed: [...m.closed.filter((c) => c !== id), id],
    maximised: m.maximised === id ? null : m.maximised,
  };
}

/** Opens a closed card at the right of everything, taking a quarter of the width; then it can be moved anywhere. */
export function open(m: Mosaic, id: string): Mosaic {
  const closed = m.closed.filter((c) => c !== id);
  if (!m.root) return { ...m, root: { card: id }, closed };
  if (cardsOf(m.root).includes(id)) return { ...m, closed };
  return {
    ...m,
    closed,
    root: { dir: "row", ratio: 0.75, a: m.root, b: { card: id } },
  };
}

/** Moves a card onto another: beside it on one side, dividing it, or in its place (center), the two swapping. */
export function dock(
  m: Mosaic,
  id: string,
  target: string,
  side: Side,
  adding = false,
): Mosaic {
  if (!m.root || id === target) return m;
  const present = cardsOf(m.root);
  if (!present.includes(target) || (!adding && !present.includes(id))) return m;
  if (side === "center") {
    const swap = (t: Tile): Tile =>
      isCard(t)
        ? { card: t.card === id ? target : t.card === target ? id : t.card }
        : { ...t, a: swap(t.a), b: swap(t.b) };
    return { ...m, root: swap(m.root) };
  }
  const rest = adding ? m.root : without(m.root, id);
  if (!rest) return m;
  const split = (t: Tile): Tile => {
    if (isCard(t)) {
      if (t.card !== target) return t;
      const mine: Tile = { card: id };
      const dir = side === "left" || side === "right" ? "row" : "col";
      const first = side === "left" || side === "top";
      return { dir, ratio: 0.5, a: first ? mine : t, b: first ? t : mine };
    }
    return { ...t, a: split(t.a), b: split(t.b) };
  };
  return { ...m, root: split(rest) };
}

/** The card before or after this one in reading order: the keyboard's way of moving a card, swapping it. */
export function neighbour(
  m: Mosaic,
  id: string,
  dir: "left" | "right" | "up" | "down",
): string | null {
  const order = cardsOf(m.root);
  const i = order.indexOf(id);
  if (i < 0) return null;
  return order[dir === "left" || dir === "up" ? i - 1 : i + 1] ?? null;
}

export function maximise(m: Mosaic, id: string): Mosaic {
  return { ...m, maximised: m.maximised === id ? null : id };
}

/** Where a card dragged over a target would go, from where the pointer is in it (fractions of its width and height,
 * read from the page at the moment of the drop): an edge band of a quarter docks beside it, the middle swaps. */
export function sideAt(fx: number, fy: number): Side {
  const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
  if (edge > 0.25) return "center";
  if (edge === fx) return "left";
  if (edge === 1 - fx) return "right";
  return edge === fy ? "top" : "bottom";
}

/** The mosaic kept for these cards: the one kept, with new cards opened and gone ones dropped; else the default. */
export function arrange(
  defaults: Mosaic,
  kept: Mosaic | null,
  all: readonly string[],
): Mosaic {
  if (!kept) return defaults;
  const known = new Set(all);
  let root = kept.root;
  for (const c of cardsOf(kept.root)) {
    if (!known.has(c) && root) root = without(root, c);
  }
  const shown = cardsOf(root);
  const closed = kept.closed.filter((c) => known.has(c) && !shown.includes(c));
  let m: Mosaic = {
    root,
    closed,
    maximised: kept.maximised && shown.includes(kept.maximised)
      ? kept.maximised
      : null,
  };
  for (const c of all) {
    if (!shown.includes(c) && !closed.includes(c)) m = open(m, c);
  }
  return m;
}

export function kept(key: string): Mosaic | null {
  try {
    const raw = globalThis.localStorage?.getItem(`naima-mosaic:${key}`);
    return raw ? (JSON.parse(raw) as Mosaic) : null;
  } catch {
    return null;
  }
}

export function keep(key: string, m: Mosaic): void {
  try {
    globalThis.localStorage?.setItem(`naima-mosaic:${key}`, JSON.stringify(m));
  } catch {
    // A browser that keeps nothing still shows the mosaic; it is only not kept.
  }
}

// ---- dividers, junctions, and moving them (develop/models-tab.md §13): all from the tree's ratios, never from the page.
// A division of direction "row" puts its sides left and right of a vertical divider; "col", above and below a horizontal
// one. In the unit square of the mosaic each divider is a line: where it stands on its axis (`at`), and the span it
// covers on the other (`from`, `to`). Two dividers of one direction standing at the same place are aligned, whatever
// division they belong to.

/** A rectangle of the unit square: where a tile stands in the mosaic. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A divider of the mosaic: the division's path, its direction, where it stands, the span it covers, its tile's rect. */
export interface Divider {
  path: string;
  dir: "row" | "col";
  at: number;
  from: number;
  to: number;
  rect: Rect;
}

/** How close two lines must be to count as one, in the unit square. */
const EPS = 0.004;
/** How close a dragged line must come to an aligned one to snap onto it. */
export const SNAP = 0.015;

/** Every divider of the tree, parents before their children. */
export function dividers(t: Tile | null, rect: Rect = { x: 0, y: 0, w: 1, h: 1 }, path = ""): Divider[] {
  if (!t || isCard(t)) return [];
  if (t.dir === "row") {
    const x = rect.x + t.ratio * rect.w;
    return [
      { path, dir: "row", at: x, from: rect.y, to: rect.y + rect.h, rect },
      ...dividers(t.a, { ...rect, w: x - rect.x }, `${path}a`),
      ...dividers(t.b, { ...rect, x, w: rect.x + rect.w - x }, `${path}b`),
    ];
  }
  const y = rect.y + t.ratio * rect.h;
  return [
    { path, dir: "col", at: y, from: rect.x, to: rect.x + rect.w, rect },
    ...dividers(t.a, { ...rect, h: y - rect.y }, `${path}a`),
    ...dividers(t.b, { ...rect, y, h: rect.y + rect.h - y }, `${path}b`),
  ];
}

/** A point where a divider's end meets another divider: a T, or with one more on the other side, a cross. */
export interface Junction {
  x: number;
  y: number;
  /** The dividers meeting there. */
  meeting: string[];
  /** Every divider that moves when the junction is dragged: those meeting there and every one on their lines. */
  moves: string[];
  /** Whether it is a cross (four directions) rather than a T (three). */
  cross: boolean;
}

const near = (a: number, b: number) => Math.abs(a - b) < EPS;

/** The point at an end of a divider: its start (top, or left) or its end. */
const endOf = (d: Divider, end: "start" | "end") =>
  d.dir === "row" ? { x: d.at, y: end === "start" ? d.from : d.to } : { x: end === "start" ? d.from : d.to, y: d.at };

/** The junction at one end of a divider, or null when that end is on the mosaic's border. */
export function junctionAt(t: Tile | null, path: string, end: "start" | "end"): Junction | null {
  const all = dividers(t);
  const d = all.find((x) => x.path === path);
  if (!d) return null;
  const p = endOf(d, end);
  const on = (x: Divider) => (x.dir === "row" ? near(x.at, p.x) && x.from - EPS <= p.y && p.y <= x.to + EPS : near(x.at, p.y) && x.from - EPS <= p.x && p.x <= x.to + EPS);
  const meeting = all.filter(on).map((x) => x.path);
  if (!all.some((x) => x.dir !== d.dir && on(x))) return null;
  const xs = all.filter((x) => x.dir === "row" && meeting.includes(x.path)).map((x) => x.at);
  const ys = all.filter((x) => x.dir === "col" && meeting.includes(x.path)).map((x) => x.at);
  const moves = all.filter((x) => (x.dir === "row" ? xs : ys).some((a) => near(a, x.at))).map((x) => x.path);
  // A cross: dividers leave the point in all four directions.
  const ways = new Set<string>();
  for (const x of all.filter(on)) {
    if (x.dir === "row") {
      if (x.from < p.y - EPS) ways.add("up");
      if (x.to > p.y + EPS) ways.add("down");
    } else {
      if (x.from < p.x - EPS) ways.add("left");
      if (x.to > p.x + EPS) ways.add("right");
    }
  }
  return { ...p, meeting, moves, cross: ways.size === 4 };
}

/** Which ends of a divider are junctions, to draw a handle there. */
export function junctionEnds(t: Tile | null, path: string): { start: boolean; end: boolean } {
  return { start: junctionAt(t, path, "start") !== null, end: junctionAt(t, path, "end") !== null };
}

/**
 * Moves the dividers `paths` by `delta` in the unit square, each along its own axis; every other divider stays where it
 * stands. With `snap`, a moved line that comes within SNAP of an aligned line of its direction lands on it. Each ratio is
 * then what puts its divider where it now stands, parents first, within the bounds a card keeps.
 */
export function moveDividers(m: Mosaic, paths: readonly string[], delta: { x: number; y: number }, snap = true): Mosaic {
  if (!m.root) return m;
  const all = dividers(m.root);
  const moved = new Set(paths);
  const d = { ...delta };
  if (snap) {
    for (const axis of ["row", "col"] as const) {
      const shift = axis === "row" ? "x" : "y";
      const mine = all.filter((x) => x.dir === axis && moved.has(x.path));
      const others = all.filter((x) => x.dir === axis && !moved.has(x.path));
      let best: number | null = null;
      for (const a of mine) {
        for (const o of others) {
          const gap = o.at - (a.at + d[shift]);
          if (Math.abs(gap) < SNAP && (best === null || Math.abs(gap) < Math.abs(best))) best = gap;
        }
      }
      if (best !== null) d[shift] += best;
    }
  }
  const target = new Map(all.map((x) => [x.path, x.at + (moved.has(x.path) ? (x.dir === "row" ? d.x : d.y) : 0)]));
  const place = (t: Tile, rect: Rect, path: string): Tile => {
    if (isCard(t)) return t;
    const goal = target.get(path)!;
    const ratio = t.dir === "row" ? clamp((goal - rect.x) / rect.w) : clamp((goal - rect.y) / rect.h);
    if (t.dir === "row") {
      const x = rect.x + ratio * rect.w;
      return { ...t, ratio, a: place(t.a, { ...rect, w: x - rect.x }, `${path}a`), b: place(t.b, { ...rect, x, w: rect.x + rect.w - x }, `${path}b`) };
    }
    const y = rect.y + ratio * rect.h;
    return { ...t, ratio, a: place(t.a, { ...rect, h: y - rect.y }, `${path}a`), b: place(t.b, { ...rect, y, h: rect.y + rect.h - y }, `${path}b`) };
  };
  return { ...m, root: place(m.root, { x: 0, y: 0, w: 1, h: 1 }, "") };
}

/** Whether a move snapped: some moved line now stands on an aligned line it did not stand on. */
export const snappedTo = (m: Mosaic, paths: readonly string[]): boolean => {
  const all = dividers(m.root);
  return all.some((a) => paths.includes(a.path) && all.some((o) => o.dir === a.dir && !paths.includes(o.path) && near(o.at, a.at)));
};

// ---- the drag machine, by hand after its verified model (develop/models/ui/mosaic-drag/mosaic-drag.mcrl2)

export type Over = "NOTHING" | "DIVIDER" | "JUNCTION";
export type DragKind = "NONE" | "ONE" | "SET";
export interface DragState {
  over: Over;
  drag: DragKind;
}
export type DragEvent = "enter_divider" | "enter_junction" | "leave" | "press" | "move" | "release" | "cancel";

export const DRAG_IDLE: DragState = { over: "NOTHING", drag: "NONE" };

/** One event of the pointer: the next state, or null when the model does not allow it now (and nothing happens). */
export function dragStep(s: DragState, e: DragEvent): DragState | null {
  if (s.drag === "NONE") {
    if (e === "enter_divider") return { ...s, over: "DIVIDER" };
    if (e === "enter_junction") return { ...s, over: "JUNCTION" };
    if (e === "leave") return s.over === "NOTHING" ? null : { ...s, over: "NOTHING" };
    if (e === "press") return s.over === "DIVIDER" ? { ...s, drag: "ONE" } : s.over === "JUNCTION" ? { ...s, drag: "SET" } : null;
    return null;
  }
  if (e === "move") return s;
  if (e === "enter_divider" || e === "enter_junction" || e === "leave") return s;
  return { ...s, drag: "NONE" };
}
