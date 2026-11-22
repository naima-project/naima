// The one list every long list of the UI shares (List.svelte), the pure part: what the caller declares (the columns an
// item has, the facets it is filtered by, the groupings it is grouped by), what the person chose (the view: the words
// searched, the filters, the sort, the grouping, the groups folded, the columns hidden), what the list draws for both
// (the groups with their counts, the places in the order drawn, the filters with their counts), and where the keyboard
// is (the cursor), moved as the model models/list/list.mcrl2 says. Plain functions, no Svelte, so the tests
// run them as they are.

/** A column an item has: its heading, the value it sorts by, and what its cell says. */
export interface Column<T> {
  readonly id: string;
  readonly label: string;
  /** The value the column sorts by; null or "" sorts last, whichever the direction. */
  readonly value: (item: T) => string | number | null;
  /** What the cell says; the value as text when left out. */
  readonly text?: (item: T) => string;
  /** How much room it takes: the rest of the row (the title), what its widest cell needs, or a few characters. */
  readonly width?: "grow" | "fit" | "narrow";
  readonly align?: "start" | "end";
  /** Kept beside an item open, where the list is a narrow column: the title, and a short label over it. */
  readonly column?: boolean;
  /** Hidden until the person shows it. */
  readonly optional?: boolean;
  /** First chosen, it sorts the largest first (the age: the oldest first; a priority's rank, the most urgent first). */
  readonly descFirst?: boolean;
}

/** What items are filtered by: each item's values (none, one or several, such as its tags), and their names. */
export interface Facet<T> {
  readonly id: string;
  readonly label: string;
  readonly values: (item: T) => readonly string[];
  /** A value as a person reads it; the value itself when left out. */
  readonly name?: (value: string) => string;
  /** The values in this order first, the others after by how many items have them. */
  readonly order?: readonly string[];
}

/** What items are grouped by: each item's group, by its key, its heading, and its place among the groups. */
export interface Grouping<T> {
  readonly id: string;
  readonly label: string;
  readonly group: (item: T) => { readonly key: string; readonly title: string; readonly rank?: number };
}

/** What the list knows of the items: how each is named, and what it can show, filter and group by. */
export interface ListSpec<T> {
  readonly key: (item: T) => string;
  readonly columns: readonly Column<T>[];
  readonly facets?: readonly Facet<T>[];
  readonly groupings?: readonly Grouping<T>[];
}

/** What the person chose. */
export interface ListView {
  readonly search: string;
  /** The column sorted by, or null for the order the items came in (the screen's own). */
  readonly sort: string | null;
  readonly desc: boolean;
  /** The grouping, by its id, or "" for none. */
  readonly group: string;
  /** By facet, the values kept; an item is kept when it has one of them, for every facet that keeps some. */
  readonly filters: Readonly<Record<string, readonly string[]>>;
  /** The groups folded, by key. */
  readonly folded: readonly string[];
  /** The optional columns shown and the others hidden, by id: those named here turn the other way. */
  readonly toggled: readonly string[];
}

export const EMPTY_VIEW: ListView = {
  search: "",
  sort: null,
  desc: false,
  group: "",
  filters: {},
  folded: [],
  toggled: [],
};

/** A filter's value with how many items have it among those the search and the other facets keep. */
export interface FilterChip {
  readonly facet: string;
  readonly value: string;
  readonly label: string;
  readonly count: number;
  readonly on: boolean;
}

export interface FacetChips {
  readonly id: string;
  readonly label: string;
  readonly chips: readonly FilterChip[];
}

export interface ListGroup<T> {
  readonly key: string;
  readonly title: string;
  /** How many items the group holds, folded or not. */
  readonly count: number;
  readonly folded: boolean;
  readonly items: readonly T[];
}

/** A place the keyboard can be at: a group's heading, or an item's row. */
export type Place = { readonly kind: "head"; readonly group: string } | {
  readonly kind: "row";
  readonly key: string;
  readonly group: string;
};

export interface ListModel<T> {
  /** The groups in order; one group with the key "" when the list is not grouped. */
  readonly groups: readonly ListGroup<T>[];
  /** Every place drawn, in the order drawn: each group's heading (when grouped), then its rows unless folded. */
  readonly places: readonly Place[];
  readonly facets: readonly FacetChips[];
  /** The columns drawn. */
  readonly columns: readonly Column<unknown>[];
  readonly total: number;
  /** How many items the search and the filters keep. */
  readonly shown: number;
  /** By item key, its group's key under the grouping chosen, for every item, kept or not. */
  readonly groupOf: ReadonlyMap<string, string>;
}

// ---- What the items say.

/** What a column's cell says for an item. */
export function cellText<T>(c: Column<T>, item: T): string {
  if (c.text) return c.text(item);
  const v = c.value(item);
  return v === null ? "" : String(v);
}

/** The items whose cells and key hold every word searched, in any case. */
export function searchItems<T>(items: readonly T[], spec: ListSpec<T>, text: string): T[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...items];
  return items.filter((i) => {
    const hay = `${spec.key(i)} ${spec.columns.map((c) => cellText(c, i)).join(" ")} ${
      (spec.facets ?? []).flatMap((f) => f.values(i).map((v) => f.name?.(v) ?? v)).join(" ")
    }`
      .toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The items every facet keeps, leaving out the facet `except` (to count that facet's own values). */
export function filterItems<T>(items: readonly T[], spec: ListSpec<T>, filters: ListView["filters"], except = ""): T[] {
  const active = (spec.facets ?? []).filter((f) => f.id !== except && (filters[f.id]?.length ?? 0) > 0);
  if (!active.length) return [...items];
  return items.filter((i) => active.every((f) => f.values(i).some((v) => filters[f.id]!.includes(v))));
}

/** Each facet's values with their counts, among the items the search and the other facets keep. A value chosen stays
 *  listed with its count even when no item has it now, so it can be taken off. */
export function facetChips<T>(found: readonly T[], spec: ListSpec<T>, filters: ListView["filters"]): FacetChips[] {
  return (spec.facets ?? []).map((f) => {
    const counts = new Map<string, number>();
    for (const i of filterItems(found, spec, filters, f.id)) {
      for (const v of new Set(f.values(i))) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const on = filters[f.id] ?? [];
    for (const v of on) if (!counts.has(v)) counts.set(v, 0);
    const order = f.order ?? [];
    const at = (v: string) => (order.includes(v) ? order.indexOf(v) : order.length);
    const values = [...counts.entries()].sort((a, b) => at(a[0]) - at(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0]));
    return {
      id: f.id,
      label: f.label,
      chips: values.map(([v, n]) => ({ facet: f.id, value: v, label: f.name?.(v) ?? v, count: n, on: on.includes(v) })),
    };
  });
}

const empty = (v: string | number | null): boolean => v === null || v === "";

/** The items sorted by a column, stable; empty values last whichever the direction. */
export function sortItems<T>(items: readonly T[], col: Column<T> | undefined, desc: boolean): T[] {
  if (!col) return [...items];
  const sign = desc ? -1 : 1;
  return items
    .map((item, n) => ({ item, n, v: col.value(item) }))
    .sort((a, b) => {
      if (empty(a.v) || empty(b.v)) return Number(empty(a.v)) - Number(empty(b.v)) || a.n - b.n;
      const c = typeof a.v === "number" && typeof b.v === "number"
        ? a.v - b.v
        : String(a.v).localeCompare(String(b.v), "en", { sensitivity: "base", numeric: true });
      return sign * c || a.n - b.n;
    })
    .map((x) => x.item);
}

/** The items in groups, ordered by the groups' ranks, then by where their first item stands. */
export function groupItems<T>(
  items: readonly T[],
  grouping: Grouping<T> | undefined,
): { key: string; title: string; items: T[] }[] {
  if (!grouping) return [{ key: "", title: "", items: [...items] }];
  const out = new Map<string, { key: string; title: string; rank: number; first: number; items: T[] }>();
  items.forEach((i, n) => {
    const g = grouping.group(i);
    const e = out.get(g.key) ??
      { key: g.key, title: g.title, rank: g.rank ?? Number.MAX_SAFE_INTEGER, first: n, items: [] };
    e.items.push(i);
    out.set(g.key, e);
  });
  return [...out.values()].sort((a, b) => a.rank - b.rank || a.first - b.first).map(({ key, title, items }) => ({
    key,
    title,
    items,
  }));
}

/** Whether a column is drawn: an optional one when toggled on, any other unless toggled off; the first grow column
 *  (the title) always. */
export function columnShown<T>(c: Column<T>, v: ListView, spec: ListSpec<T>): boolean {
  if (c === spec.columns.find((x) => x.width === "grow")) return true;
  return v.toggled.includes(c.id) ? !!c.optional : !c.optional;
}

/** What the list draws for the items and the view. */
export function listModel<T>(items: readonly T[], spec: ListSpec<T>, v: ListView): ListModel<T> {
  const found = searchItems(items, spec, v.search);
  const kept = filterItems(found, spec, v.filters);
  const grouping = spec.groupings?.find((g) => g.id === v.group);
  const col = v.sort ? spec.columns.find((c) => c.id === v.sort) : undefined;
  const groups = groupItems(sortItems(kept, col, v.desc), grouping).map((g) => ({
    ...g,
    count: g.items.length,
    folded: !!grouping && v.folded.includes(g.key),
  }));
  const places: Place[] = [];
  for (const g of groups) {
    if (grouping) places.push({ kind: "head", group: g.key });
    if (!g.folded) { for (const i of g.items) places.push({ kind: "row", key: spec.key(i), group: g.key }); }
  }
  const groupOf = new Map(items.map((i) => [spec.key(i), grouping ? grouping.group(i).key : ""]));
  return {
    groups,
    places,
    facets: facetChips(found, spec, v.filters),
    columns: spec.columns.filter((c) => columnShown(c, v, spec)) as Column<unknown>[],
    total: items.length,
    shown: kept.length,
    groupOf,
  };
}

// ---- What the person does to the view.

/** A filter's value turned on or off. */
export function toggleFilter(v: ListView, facet: string, value: string): ListView {
  const on = v.filters[facet] ?? [];
  const next = on.includes(value) ? on.filter((x) => x !== value) : [...on, value];
  const filters = { ...v.filters, [facet]: next };
  if (!next.length) delete filters[facet];
  return { ...v, filters };
}

/** Every filter taken off. */
export const clearFilters = (v: ListView): ListView => ({ ...v, filters: {} });

/** How many filter values are on. */
export const filtersOn = (v: ListView): number => Object.values(v.filters).reduce((n, xs) => n + xs.length, 0);

/** A column's heading pressed: the same column turns its direction, another starts in its own first direction; a third
 *  press on the same column goes back to the order the items came in. */
export function sortBy<T>(v: ListView, col: Column<T>): ListView {
  const first = !!col.descFirst;
  if (v.sort !== col.id) return { ...v, sort: col.id, desc: first };
  if (v.desc === first) return { ...v, desc: !first };
  return { ...v, sort: null, desc: false };
}

/** A group folded or unfolded. */
export function toggleFold(v: ListView, group: string): ListView {
  return { ...v, folded: v.folded.includes(group) ? v.folded.filter((g) => g !== group) : [...v.folded, group] };
}

/** Another grouping: its groups all unfolded (the model's regroup). */
export const regroup = (v: ListView, group: string): ListView => ({ ...v, group, folded: [] });

/** An optional column shown, or another hidden. */
export function toggleColumn(v: ListView, col: string): ListView {
  return { ...v, toggled: v.toggled.includes(col) ? v.toggled.filter((c) => c !== col) : [...v.toggled, col] };
}

// ---- The cursor, as the model moves it (models/list/list.mcrl2).

/** A place as one string, for the cursor and the rows' ids: "h:<group>" or "r:<key>". */
export const placeId = (p: Place): string => (p.kind === "head" ? `h:${p.group}` : `r:${p.key}`);
export const rowId = (key: string): string => `r:${key}`;
export const headId = (group: string): string => `h:${group}`;

/** The key the arrows (or j and k), Home and End move the cursor to, or null when nothing is drawn there. Over the
 *  headings and the rows of the whole list; beside an item open (`column`), over the rows only. At either end, the
 *  cursor stays. */
export function move(places: readonly Place[], cursor: string | null, key: string, column: boolean): string | null {
  const ids = places.filter((p) => !column || p.kind === "row").map(placeId);
  if (!ids.length) return cursor;
  const at = cursor === null ? -1 : ids.indexOf(cursor);
  switch (key) {
    case "ArrowDown":
    case "j":
      return at < 0 ? ids[0]! : ids[Math.min(ids.length - 1, at + 1)]!;
    case "ArrowUp":
    case "k":
      return at < 0 ? ids[ids.length - 1]! : ids[Math.max(0, at - 1)]!;
    case "Home":
      return ids[0]!;
    case "End":
      return ids[ids.length - 1]!;
    default:
      return cursor;
  }
}

/** Whether a place is drawn. */
export const drawn = (places: readonly Place[], id: string | null): boolean =>
  id !== null && places.some((p) => placeId(p) === id);

/** Where the cursor is after the rows changed (the search, a filter, the sort, the grouping, the items themselves):
 *  beside an item open, on the heading it was on if still drawn, else on the item's row when drawn, else nowhere; over
 *  the whole list, on what it was on while drawn, else nowhere. */
export function afterChange(places: readonly Place[], cursor: string | null, open: string | null): string | null {
  if (open !== null) {
    if (cursor?.startsWith("h:") && drawn(places, cursor)) return cursor;
    return drawn(places, rowId(open)) ? rowId(open) : null;
  }
  return drawn(places, cursor) ? cursor : null;
}

/** Where the cursor goes when the item open closes: its row, or its group's heading when the row is folded away, or
 *  nowhere when a filter took it out. */
export function afterClose(m: Pick<ListModel<unknown>, "places" | "groupOf">, was: string): string | null {
  if (drawn(m.places, rowId(was))) return rowId(was);
  const g = m.groupOf.get(was);
  return g !== undefined && drawn(m.places, headId(g)) ? headId(g) : null;
}

/** The left arrow: from a row to its group's heading (when grouped); from an unfolded heading, fold it. The right arrow
 *  unfolds a folded heading. What the key does, or null when it does nothing. */
export function sideways(
  m: Pick<ListModel<unknown>, "places" | "groups">,
  cursor: string | null,
  key: "ArrowLeft" | "ArrowRight",
): { readonly cursor: string } | { readonly fold: string } | null {
  const p = m.places.find((x) => placeId(x) === cursor);
  if (!p) return null;
  if (p.kind === "row") {
    return key === "ArrowLeft" && drawn(m.places, headId(p.group)) ? { cursor: headId(p.group) } : null;
  }
  const folded = m.groups.find((g) => g.key === p.group)?.folded ?? false;
  return (key === "ArrowLeft") !== folded ? { fold: p.group } : null;
}

// ---- Views kept by name in the browser.

/** A view read back from what was kept, whatever is not a view's dropped. */
export function readView(raw: unknown): ListView {
  const w = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof ListView, unknown>>;
  const strings = (
    x: unknown,
  ): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
  const filters: Record<string, string[]> = {};
  if (w.filters && typeof w.filters === "object") {
    for (const [k, xs] of Object.entries(w.filters as Record<string, unknown>)) {
      if (strings(xs).length) filters[k] = strings(xs);
    }
  }
  return {
    search: typeof w.search === "string" ? w.search : "",
    sort: typeof w.sort === "string" ? w.sort : null,
    desc: w.desc === true,
    group: typeof w.group === "string" ? w.group : "",
    filters,
    folded: strings(w.folded),
    toggled: strings(w.toggled),
  };
}
