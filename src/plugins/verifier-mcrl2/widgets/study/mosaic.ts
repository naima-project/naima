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
