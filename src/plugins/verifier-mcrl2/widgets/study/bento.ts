// A bento's arrangement (develop/models-tab.md §11): its cards in order, each with a width in columns of twelve, a
// height in rows, and whether it is folded; and the one card maximised, if any. Plain data, so that it is kept as it
// is (per study, in the browser) and tested without a page. A card's content never changes its size: it scrolls, pans
// or zooms inside, so a growing card never moves the others.

export interface Card {
  id: string;
  /** Columns of twelve. */
  span: number;
  /** Rows of the bento's row height. */
  rows: number;
  folded: boolean;
}

export interface Arrangement {
  cards: Card[];
  maximised: string | null;
}

export const COLUMNS = 12;
export const SPANS = [3, 4, 6, 8, 12] as const;
export const MAX_ROWS = 8;

/** The arrangement for these cards: the one kept, with cards it lacks added in the default's place and gone ones left out. */
export function arrange(
  defaults: readonly Card[],
  kept: Arrangement | null,
): Arrangement {
  if (!kept) return { cards: defaults.map((c) => ({ ...c })), maximised: null };
  const ids = new Set(defaults.map((c) => c.id));
  const cards: Card[] = kept.cards.filter((c) => ids.has(c.id)).map((c) => ({
    ...c,
    span: clampSpan(c.span) as number,
    rows: clampRows(c.rows),
  }));
  for (const [i, d] of defaults.entries()) {
    if (!cards.some((c) => c.id === d.id)) {
      cards.splice(Math.min(i, cards.length), 0, { ...d });
    }
  }
  return {
    cards,
    maximised: kept.maximised !== null && ids.has(kept.maximised)
      ? kept.maximised
      : null,
  };
}

const clampSpan = (s: number) =>
  SPANS.reduce(
    (best, x) => (Math.abs(x - s) < Math.abs(best - s) ? x : best),
    SPANS[0],
  );
const clampRows = (r: number) => Math.max(1, Math.min(MAX_ROWS, Math.round(r)));

/** Moves a card one place earlier (-1) or later (+1) in the reading order. */
export function move(a: Arrangement, id: string, by: -1 | 1): Arrangement {
  const i = a.cards.findIndex((c) => c.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= a.cards.length) return a;
  const cards = [...a.cards];
  [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  return { ...a, cards };
}

/** Moves a card up or down by about a row of the grid: past the cards that fill the columns before or after it. */
export function moveRow(a: Arrangement, id: string, by: -1 | 1): Arrangement {
  const i = a.cards.findIndex((c) => c.id === id);
  if (i < 0) return a;
  let room = COLUMNS;
  let j = i;
  while (room > 0 && j + by >= 0 && j + by < a.cards.length) {
    j += by;
    room -= a.cards[j]!.span;
  }
  if (j === i) return a;
  const cards = [...a.cards];
  const [c] = cards.splice(i, 1);
  cards.splice(j, 0, c!);
  return { ...a, cards };
}

export function widen(a: Arrangement, id: string, by: -1 | 1): Arrangement {
  return update(a, id, (c) => {
    const k = SPANS.indexOf(clampSpan(c.span) as (typeof SPANS)[number]) + by;
    return { ...c, span: SPANS[Math.max(0, Math.min(SPANS.length - 1, k))]! };
  });
}

export function grow(a: Arrangement, id: string, by: -1 | 1): Arrangement {
  return update(a, id, (c) => ({ ...c, rows: clampRows(c.rows + by) }));
}

export function fold(a: Arrangement, id: string): Arrangement {
  return update(a, id, (c) => ({ ...c, folded: !c.folded }));
}

/** Maximises a card to the whole bento, or restores the bento when it is the one maximised. */
export function maximise(a: Arrangement, id: string): Arrangement {
  return { ...a, maximised: a.maximised === id ? null : id };
}

const update = (
  a: Arrangement,
  id: string,
  f: (c: Card) => Card,
): Arrangement => ({
  ...a,
  cards: a.cards.map((c) => (c.id === id ? f(c) : c)),
});

/** The arrangement kept for a key in the browser, or null when there is none or it cannot be read. */
export function kept(key: string): Arrangement | null {
  try {
    const raw = globalThis.localStorage?.getItem(`naima-bento:${key}`);
    return raw ? (JSON.parse(raw) as Arrangement) : null;
  } catch {
    return null;
  }
}

export function keep(key: string, a: Arrangement): void {
  try {
    globalThis.localStorage?.setItem(`naima-bento:${key}`, JSON.stringify(a));
  } catch {
    // A browser that keeps nothing still shows the arrangement; it is only not kept.
  }
}
