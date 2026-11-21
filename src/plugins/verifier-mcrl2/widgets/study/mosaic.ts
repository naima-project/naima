// A mosaic of cards (develop/models-tab.md §13): the window divided again and again, each piece a card, so the cards
// always tile the whole space, like a Mondrian canvas. Each division has a ratio, moved by dragging the gutter between
// its two sides. A card moved onto the edge of another divides that one; moved onto its middle, the two swap; closed,
// its space goes to its neighbour. Plain data, kept per study and tested without a page.

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

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A gutter between the two sides of a division: where it is, and the path to the division in the tree. */
export interface Gutter extends Rect {
  path: string;
  dir: "row" | "col";
  /** The division's own space, to turn a drag into a ratio. */
  span: number;
}

const MIN = 0.12;
const clamp = (r: number) => Math.max(MIN, Math.min(1 - MIN, r));
const isCard = (t: Tile): t is { card: string } => "card" in t;

/** Every card in the mosaic, in reading order. */
export function cardsOf(t: Tile | null): string[] {
  if (!t) return [];
  return isCard(t) ? [t.card] : [...cardsOf(t.a), ...cardsOf(t.b)];
}

/** Where every card and every gutter is, in a box of w by h with gutters g wide. */
export function place(
  m: Mosaic,
  w: number,
  h: number,
  g: number,
): { cards: Map<string, Rect>; gutters: Gutter[] } {
  const cards = new Map<string, Rect>();
  const gutters: Gutter[] = [];
  if (m.maximised && cardsOf(m.root).includes(m.maximised)) {
    cards.set(m.maximised, { x: 0, y: 0, w, h });
    return { cards, gutters };
  }
  const walk = (t: Tile, r: Rect, path: string) => {
    if (isCard(t)) {
      cards.set(t.card, r);
      return;
    }
    if (t.dir === "row") {
      const aw = Math.round((r.w - g) * t.ratio);
      walk(t.a, { x: r.x, y: r.y, w: aw, h: r.h }, `${path}a`);
      walk(
        t.b,
        { x: r.x + aw + g, y: r.y, w: r.w - aw - g, h: r.h },
        `${path}b`,
      );
      gutters.push({
        path,
        dir: "row",
        x: r.x + aw,
        y: r.y,
        w: g,
        h: r.h,
        span: r.w - g,
      });
    } else {
      const ah = Math.round((r.h - g) * t.ratio);
      walk(t.a, { x: r.x, y: r.y, w: r.w, h: ah }, `${path}a`);
      walk(
        t.b,
        { x: r.x, y: r.y + ah + g, w: r.w, h: r.h - ah - g },
        `${path}b`,
      );
      gutters.push({
        path,
        dir: "col",
        x: r.x,
        y: r.y + ah,
        w: r.w,
        h: g,
        span: r.h - g,
      });
    }
  };
  if (m.root) walk(m.root, { x: 0, y: 0, w, h }, "");
  return { cards, gutters };
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

/** Opens a closed card beside the largest card, dividing it along its longer side. */
export function open(m: Mosaic, id: string, w: number, h: number): Mosaic {
  const closed = m.closed.filter((c) => c !== id);
  if (!m.root) return { ...m, root: { card: id }, closed };
  if (cardsOf(m.root).includes(id)) return { ...m, closed };
  const { cards } = place({ ...m, maximised: null }, w, h, 0);
  let best = cardsOf(m.root)[0]!;
  let area = -1;
  for (const [c, r] of cards) {
    if (r.w * r.h > area) {
      area = r.w * r.h;
      best = c;
    }
  }
  const r = cards.get(best)!;
  return dock(
    { ...m, closed },
    id,
    best,
    r.w >= r.h ? "right" : "bottom",
    true,
  );
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

/** The card next to this one in a direction, by their places: the keyboard's way of moving a card. */
export function neighbour(
  m: Mosaic,
  id: string,
  dir: "left" | "right" | "up" | "down",
  w: number,
  h: number,
): string | null {
  const { cards } = place({ ...m, maximised: null }, w, h, 0);
  const me = cards.get(id);
  if (!me) return null;
  const cx = me.x + me.w / 2;
  const cy = me.y + me.h / 2;
  let best: string | null = null;
  let dist = Infinity;
  for (const [c, r] of cards) {
    if (c === id) continue;
    const x = r.x + r.w / 2;
    const y = r.y + r.h / 2;
    const ok = dir === "left"
      ? x < cx - 1
      : dir === "right"
      ? x > cx + 1
      : dir === "up"
      ? y < cy - 1
      : y > cy + 1;
    if (!ok) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d < dist) {
      dist = d;
      best = c;
    }
  }
  return best;
}

export function maximise(m: Mosaic, id: string): Mosaic {
  return { ...m, maximised: m.maximised === id ? null : id };
}

/** Where a card dragged over a target would go: an edge band of a quarter of the card docks beside it, the middle swaps. */
export function sideAt(r: Rect, x: number, y: number): Side {
  const fx = (x - r.x) / r.w;
  const fy = (y - r.y) / r.h;
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
    if (!shown.includes(c) && !closed.includes(c)) m = open(m, c, 1600, 1000);
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
