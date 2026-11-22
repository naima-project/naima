<!-- The one list every long list of the UI shares: dense, one line an item, its columns those the items have; a search,
     filters by what the items are (kind, release or goal, state, priority, person, tag) each value with its count, a sort
     by any column (its heading, or the Sort menu), groups by a category with their counts, each folding under its
     heading. The keyboard: the arrows or j and k move over the headings and the rows, Home and End to either end, Enter
     opens a row or folds a group, the left arrow goes up to the heading and folds it, the right unfolds it, Escape closes
     the item open, / goes to the search. A click, a tap or Enter on a row opens it beside the list (`onopen`; what is open
     is the caller's, `open`): the list is then a narrow column, each row two lines, the open one marked, and the arrows
     open the row they reach, as a mail app's list beside the message open; back from the item, the keyboard is on the row
     that was open. The cursor moves as models/list/list.mcrl2 says (list.ts). Layout is CSS only: each kind
     of column has a width of its own, the same in every row, and a group off the screen is not drawn (content-visibility), its height
     reckoned from its count. One of the widget set, beside
     Action and Segmented. -->
<script lang="ts" generics="T">
  import { tick } from "svelte";
  import Search from "@lucide/svelte/icons/search";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import X from "@lucide/svelte/icons/x";
  import Action from "../study/Action.svelte";
  import Segmented from "../study/Segmented.svelte";
  import {
    afterChange,
    afterClose,
    cellText,
    clearFilters,
    type Column,
    EMPTY_VIEW,
    filtersOn,
    headId,
    type ListSpec,
    type ListView,
    listModel,
    move,
    type Place,
    placeId,
    regroup,
    rowId,
    sideways,
    sortBy,
    toggleColumn,
    toggleFilter,
    toggleFold,
  } from "./list.ts";

  interface Props {
    items: readonly T[];
    spec: ListSpec<T>;
    /** What the list is, for a screen reader: "The bugs of release 1.2". */
    label: string;
    /** What the person chose; bind it to keep it (in the address, in the browser). */
    view?: ListView;
    /** The item open beside the list, by key, or null. */
    open?: string | null;
    /** The list as a narrow column beside the item open; by default whenever one is. */
    column?: boolean;
    /** A row opened (a click, a tap, Enter, or an arrow in the column). */
    onopen?: (key: string) => void;
    /** Escape in the list with an item open. */
    onclose?: () => void;
    /** The dot a row starts with, by name (you, hands, todo, check, quiet); none when left out. */
    mark?: (item: T) => string | undefined;
    /** Words said when nothing is kept: "No bug matches". */
    nothing?: string;
  }
  let {
    items,
    spec,
    label,
    view = $bindable(EMPTY_VIEW),
    open = null,
    column,
    onopen,
    onclose,
    mark,
    nothing = "Nothing matches",
  }: Props = $props();

  /** Each kind of column's track: the title takes the room left, the others a width of their own (a token), the same in
   *  every row, so that every row lines up without measuring anything. */
  const TRACK = { grow: "minmax(0, 1fr)", fit: "var(--size-w-8)", narrow: "var(--size-w-5)" } as const;
  const uid = $props.id();
  const narrow = $derived(column ?? open !== null);
  const model = $derived(listModel(items, spec, view));
  const grouped = $derived(!!view.group && !!spec.groupings?.some((g) => g.id === view.group));
  const byKey = $derived(new Map(items.map((i) => [spec.key(i), i])));
  const cols = $derived(narrow ? (model.columns as Column<T>[]).filter((c) => c.column) : (model.columns as Column<T>[]));
  const title = $derived(cols.find((c) => c.width === "grow"));
  const tracks = $derived(
    [mark ? "var(--dot)" : "", ...cols.map((c) => TRACK[c.width ?? "fit"])].filter(Boolean).join(" "),
  );

  // The cursor: where the person put it, kept on what is drawn as the rows change (list.ts afterChange).
  let put = $state<string | null>(null);
  const cursor = $derived(afterChange(model.places, put, open));
  /** The place the Tab key enters the list at: the cursor, else the first place drawn. */
  const entry = $derived(cursor ?? (model.places[0] ? placeId(model.places[0]) : null));
  let filtering = $state(false);
  let search = $state<HTMLInputElement>();
  let grid = $state<HTMLDivElement>();

  const domId = (place: string) => `${uid}-${place}`;
  async function focus(place: string | null) {
    await tick();
    if (place) document.getElementById(domId(place))?.focus();
  }
  function go(place: Place | undefined) {
    if (!place) return;
    put = placeId(place);
    if (place.kind === "row") onopen?.(place.key);
    else view = toggleFold(view, place.group);
  }
  function keys(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const at = model.places.find((p) => placeId(p) === cursor);
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
      case "j":
      case "k":
      case "Home":
      case "End": {
        e.preventDefault();
        const to = move(model.places, cursor, e.key, narrow);
        if (to === cursor) return;
        put = to;
        const p = model.places.find((x) => placeId(x) === to);
        if (narrow && p?.kind === "row") onopen?.(p.key);
        void focus(to);
        return;
      }
      case "Enter":
      case " ":
        e.preventDefault();
        go(at);
        void focus(cursor);
        return;
      case "ArrowLeft":
      case "ArrowRight": {
        const did = sideways(model, cursor, e.key);
        if (!did) return;
        e.preventDefault();
        if ("cursor" in did) {
          put = did.cursor;
          void focus(did.cursor);
        } else view = toggleFold(view, did.fold);
        return;
      }
      case "Escape":
        if (open !== null) {
          e.preventDefault();
          onclose?.();
        }
        return;
      case "/":
        e.preventDefault();
        search?.focus();
        return;
    }
  }

  // An item opened from elsewhere (the address, another list) takes the cursor; closed, the cursor goes back to its
  // row, or its group's heading, and takes the keyboard there unless the person put it outside the list.
  let was: string | null = null;
  $effect(() => {
    const now = open;
    const before = was;
    was = now;
    if (now !== null) {
      put = rowId(now);
      return;
    }
    if (before === null) return;
    const back = afterClose(model, before);
    put = back;
    const active = document.activeElement;
    if (active && active !== document.body && !grid?.contains(active)) return;
    void focus(back);
  });

  const sortOptions = $derived([{ value: "", label: "As listed" }, ...spec.columns.map((c) => ({ value: c.id, label: c.label }))]);
  const groupOptions = $derived([{ value: "", label: "None" }, ...(spec.groupings ?? []).map((g) => ({ value: g.id, label: g.label }))]);
  const optional = $derived(spec.columns.filter((c) => c.optional || c.width !== "grow"));
  const ariaSort = (c: Column<T>) => (view.sort === c.id ? (view.desc ? "descending" : "ascending") : undefined);
</script>

<section class="list" class:narrow aria-label={label} data-part="list">
  <div class="bar">
    <label class="search">
      <Search class="glyph" aria-hidden="true" />
      <span class="hidden">Search {label}</span>
      <input
        bind:this={search}
        type="search"
        placeholder="Search"
        value={view.search}
        oninput={(e) => (view = { ...view, search: e.currentTarget.value })}
        onkeydown={(e) => {
          if (e.key === "Escape" && view.search) {
            e.preventDefault();
            e.stopPropagation();
            view = { ...view, search: "" };
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            void focus(entry);
          }
        }}
      />
    </label>
    {#if !narrow}
      {#if spec.facets?.length}
        <Action
          label={filtersOn(view) ? `Filters · ${filtersOn(view)}` : "Filters"}
          hint="Show only some kinds, releases, states, people or tags"
          icon={SlidersHorizontal}
          size="sm"
          pressed={filtering}
          onclick={() => (filtering = !filtering)}
        />
      {/if}
      {#if spec.groupings?.length}
        <Segmented label="Group by" options={groupOptions} value={view.group} onchange={(g) => (view = regroup(view, g))} />
      {/if}
      <label class="pick">
        <span>Sort</span>
        <select
          value={view.sort ?? ""}
          onchange={(e) => {
            const c = spec.columns.find((x) => x.id === e.currentTarget.value);
            view = c ? { ...view, sort: c.id, desc: !!c.descFirst } : { ...view, sort: null, desc: false };
          }}
        >
          {#each sortOptions as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
        </select>
        {#if view.sort}
          <button class="dir" type="button" aria-label={view.desc ? "Descending: make it ascending" : "Ascending: make it descending"} onclick={() => (view = { ...view, desc: !view.desc })}>{view.desc ? "↓" : "↑"}</button>
        {/if}
      </label>
      <details class="columns">
        <summary>Columns</summary>
        <fieldset>
          <legend class="hidden">Columns shown</legend>
          {#each optional as c (c.id)}
            <label><input type="checkbox" checked={model.columns.some((x) => x.id === c.id)} onchange={() => (view = toggleColumn(view, c.id))} /> {c.label}</label>
          {/each}
        </fieldset>
      </details>
    {/if}
    <span class="count" aria-live="polite">{model.shown === model.total ? model.total : `${model.shown} of ${model.total}`}</span>
  </div>

  {#if !narrow && (filtering || filtersOn(view))}
    <div class="facets" role="group" aria-label="Filters">
      {#each model.facets as f (f.id)}
        {@const chips = filtering ? f.chips : f.chips.filter((c) => c.on)}
        {#if chips.length}
          <div class="facet" role="group" aria-label={f.label}>
            <span class="flabel">{f.label}</span>
            {#each chips as c (c.value)}
              <button class="chip" class:on={c.on} type="button" aria-pressed={c.on} disabled={!c.on && c.count === 0} onclick={() => (view = toggleFilter(view, c.facet, c.value))}>
                {c.label}<span class="n">{c.count}</span>
              </button>
            {/each}
          </div>
        {/if}
      {/each}
      {#if filtersOn(view)}<Action label="Clear filters" icon={X} size="sm" onclick={() => (view = clearFilters(view))} />{/if}
    </div>
  {/if}

  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div class="grid" role="treegrid" aria-label={label} aria-rowcount={model.shown} style:--tracks={tracks} bind:this={grid} onkeydown={keys} tabindex={-1}>
    {#if !narrow}
      <div class="heads" role="row">
        {#if mark}<span class="cell" role="columnheader"><span class="hidden">Mark</span></span>{/if}
        {#each cols as c (c.id)}
          <span class="cell" role="columnheader" aria-sort={ariaSort(c)} class:end={c.align === "end"}>
            <button type="button" tabindex={-1} onclick={() => (view = sortBy(view, c))}>
              {c.label}{#if view.sort === c.id}<span aria-hidden="true">{view.desc ? " ↓" : " ↑"}</span>{/if}
            </button>
          </span>
        {/each}
      </div>
    {/if}
    {#if model.shown === 0}
      <p class="nothing">{nothing}</p>
    {/if}
    {#each model.groups as g (g.key)}
      <div class="group" role="rowgroup" class:folded={g.folded} style:--n={g.folded ? 0 : g.count}>
        {#if grouped}
          {@const id = headId(g.key)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="ghead"
            role="row"
            id={domId(id)}
            aria-level={1}
            aria-expanded={!g.folded}
            tabindex={entry === id ? 0 : -1}
            class:cursor={cursor === id}
            onclick={() => {
              put = id;
              view = toggleFold(view, g.key);
            }}
          >
            <span class="cell" role="gridcell">
              <ChevronRight class="chev" aria-hidden="true" />
              <span class="gtitle">{g.title}</span>
              <span class="n">{g.count}</span>
            </span>
          </div>
        {/if}
        {#if !g.folded}
          {#each g.items as item (spec.key(item))}
            {@const key = spec.key(item)}
            {@const id = rowId(key)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="row"
              role="row"
              id={domId(id)}
              aria-level={grouped ? 2 : 1}
              aria-selected={open === key}
              aria-current={open === key ? "true" : undefined}
              tabindex={entry === id ? 0 : -1}
              class:open={open === key}
              class:cursor={cursor === id}
              data-key={key}
              data-mark={mark?.(item)}
              onclick={() => {
                put = id;
                onopen?.(key);
              }}
            >
              {#if mark}<span class="cell dotcell" role="gridcell"><span class="dot" aria-hidden="true"></span></span>{/if}
              {#each cols as c (c.id)}
                <span class="cell" role="gridcell" class:title={c === title} class:end={c.align === "end"} data-col={c.id}>{cellText(c, item)}</span>
              {/each}
            </div>
          {/each}
        {/if}
      </div>
    {/each}
  </div>
  {#if byKey.size === 0}<span class="hidden">The list is empty.</span>{/if}
</section>

<style>
  .list {
    --dot: var(--size-dot);
    --row: var(--size-target);
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    min-inline-size: 0;
    font-size: var(--font-size-sm);
  }
  .hidden {
    position: absolute;
    inline-size: var(--border-width-thin);
    block-size: var(--border-width-thin);
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* ---- The bar: the search, then the filters, the grouping, the sort and the columns, the count at the end. */
  .bar {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-sm);
  }
  .search {
    display: inline-flex;
    flex: 1 1 var(--size-w-16);
    align-items: center;
    gap: var(--space-xs);
    min-inline-size: 0;
    max-inline-size: var(--size-w-24);
    min-block-size: var(--size-target);
    padding-inline: var(--space-sm);
    border: var(--border-width-thin) solid var(--color-border-soft);
    border-radius: var(--radius-full);
    background: var(--color-surface-soft);
    color: var(--color-text-muted);
  }
  .search:focus-within {
    outline: var(--border-width-focus) solid var(--color-focus);
  }
  .search :global(.glyph) {
    flex: none;
    inline-size: var(--size-icon);
    block-size: var(--size-icon);
  }
  .search input {
    flex: 1;
    min-inline-size: 0;
    border: var(--border-width-thin) solid transparent;
    background: transparent;
    color: var(--color-text);
    font: inherit;
  }
  .search input:focus-visible {
    outline: none;
  }
  .pick {
    display: inline-flex;
    flex-wrap: wrap;
    max-inline-size: 100%;
    align-items: center;
    gap: var(--space-xs);
    color: var(--color-text-muted);
  }
  .pick select {
    min-inline-size: 0;
    max-inline-size: 100%;
  }
  .pick select,
  .dir,
  .columns summary {
    min-block-size: var(--size-target);
    padding-inline: var(--space-sm);
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface-soft);
    border: var(--border-width-thin) solid var(--color-border-soft);
    border-radius: var(--radius-full);
    cursor: pointer;
  }
  .columns summary {
    display: inline-flex;
    align-items: center;
    list-style: none;
    color: var(--color-text-muted);
  }
  .pick select:focus-visible,
  .dir:focus-visible,
  .columns summary:focus-visible,
  .chip:focus-visible,
  .heads button:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
  }
  /* The columns on offer are not there to reach while the box is closed. */
  .columns:not([open]) fieldset {
    display: none;
  }
  .columns fieldset {
    position: absolute;
    z-index: 2;
    inset-block-start: calc(100% + var(--space-xs));
    inset-inline-start: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    margin: 0;
    padding: var(--space-sm) var(--space-md);
    min-inline-size: min(var(--size-w-12), 100%);
    max-inline-size: 100%;
    background: var(--color-surface-raised);
    border: var(--border-width-thin) solid var(--color-border);
    border-radius: var(--radius-md);
  }
  .columns label {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    min-block-size: var(--size-target);
    overflow-wrap: anywhere;
  }
  .count {
    margin-inline-start: auto;
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* ---- The filters: one line a facet, its values as chips with their counts. */
  .facets {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-xs);
  }
  .facet {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs);
  }
  .flabel {
    min-inline-size: var(--size-w-8);
    color: var(--color-text-muted);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    min-block-size: var(--size-target);
    padding: var(--space-none) var(--space-sm);
    font: inherit;
    color: var(--color-text);
    background: none;
    border: var(--border-width-thin) solid var(--color-border-soft);
    border-radius: var(--radius-full);
    cursor: pointer;
  }
  .chip:hover:not(:disabled, .on) {
    background: var(--color-accent-tint);
  }
  .chip.on {
    color: var(--color-on-accent);
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
  .chip:disabled {
    opacity: 0.38;
    cursor: default;
  }
  .n {
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .chip.on .n {
    color: inherit;
  }

  /* ---- The rows: one grid of columns every row shares; the title takes the room left. */
  .grid {
    display: flex;
    flex-direction: column;
    outline: none;
  }
  .heads,
  .row,
  .ghead {
    display: grid;
    grid-template-columns: var(--tracks);
    column-gap: var(--space-md);
  }
  /* A group off the screen is not drawn; its height is reckoned from its count of rows. */
  .group {
    content-visibility: auto;
    contain-intrinsic-size: auto calc((var(--n) + 1) * var(--row));
  }
  .heads {
    position: sticky;
    z-index: 1;
    inset-block-start: 0;
    background: var(--color-surface);
    border-block-end: var(--border-width-thin) solid var(--color-border);
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    text-transform: uppercase;
    letter-spacing: var(--font-letter-spacing-label);
  }
  .heads button {
    min-block-size: var(--row);
    padding: 0;
    border: var(--border-width-thin) solid transparent;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: inherit;
    background: none;
    cursor: pointer;
  }
  .heads [aria-sort] button {
    color: var(--color-text);
  }
  .cell {
    display: flex;
    align-items: center;
    min-inline-size: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .cell.end {
    justify-content: flex-end;
    font-variant-numeric: tabular-nums;
  }
  .row,
  .ghead {
    position: relative;
    min-block-size: var(--row);
    align-items: center;
    cursor: pointer;
    border-radius: var(--radius-sm);
    outline: none;
  }
  .row .cell {
    color: var(--color-text-muted);
  }
  .row .cell.title {
    display: block;
    color: var(--color-text);
  }
  .row:hover {
    background: var(--color-accent-tint);
  }
  .row:focus-visible,
  .ghead:focus-visible {
    box-shadow: inset 0 0 0 var(--border-width-focus) var(--color-focus);
  }
  .row.open {
    background: var(--color-accent-soft);
  }
  .nothing {
    margin: var(--space-sm) 0;
    color: var(--color-text-muted);
  }

  /* A group's heading: the chevron turned when unfolded, the category, its count. */
  .ghead {
    margin-block-start: var(--space-sm);
    font-weight: 600;
  }
  .ghead .cell {
    grid-column: 1 / -1;
    gap: var(--space-xs);
  }
  .ghead :global(.chev) {
    flex: none;
    inline-size: var(--size-icon);
    block-size: var(--size-icon);
    color: var(--color-text-muted);
    transform: rotate(90deg);
    transition: transform var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .folded .ghead :global(.chev) {
    transform: none;
  }
  .ghead .n {
    font-weight: 400;
  }
  .ghead:hover .gtitle {
    color: var(--color-accent);
  }

  /* The dot a row starts with, as the stage's lists draw it. */
  .dotcell {
    justify-content: center;
  }
  .dot {
    inline-size: var(--dot);
    block-size: var(--dot);
    border-radius: var(--radius-full);
    border: var(--border-width-thin) solid transparent;
    background: var(--color-accent);
  }
  [data-mark="hands"] .dot {
    background: var(--color-success);
  }
  [data-mark="todo"] .dot {
    background: var(--color-border-strong);
  }
  [data-mark="check"] .dot,
  [data-mark="quiet"] .dot {
    background: var(--color-text-muted);
  }
  /* A worker gone silent on the item: a ring in the colour of what is late. */
  [data-mark="silent"] .dot {
    background: transparent;
    border: calc(var(--border-width-thin) * 4) solid var(--color-danger);
  }

  /* ---- Beside an item open: a narrow column, each row its short labels over two lines of its title, the row open
     marked by the segment on the column's hairline. */
  .narrow {
    border-inline-end: var(--border-width-thin) solid var(--color-border);
  }
  .narrow .row {
    grid-template-columns: var(--dot) minmax(0, 1fr);
    column-gap: var(--space-sm);
    padding-block: var(--space-xs);
    padding-inline-end: var(--space-md);
  }
  .narrow .row .cell {
    grid-column: 2;
    grid-row: 1;
    justify-content: flex-start;
    font-size: var(--font-size-xs);
  }
  .narrow .row .dotcell {
    grid-column: 1;
    grid-row: 2;
    align-items: flex-start;
    padding-block-start: var(--space-xs);
  }
  .narrow .row .cell.title {
    grid-row: 2;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    white-space: normal;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }
  .narrow .row.open {
    background: none;
  }
  .narrow .row.open .cell.title {
    color: var(--color-accent);
  }
  .narrow .row.open::after {
    content: "";
    position: absolute;
    inset-block: var(--space-xs);
    inset-inline-end: 0;
    inline-size: var(--border-width-focus);
    border-radius: var(--radius-full);
    background: var(--color-accent);
  }
  .narrow .search {
    max-inline-size: none;
  }

  @media (pointer: coarse) {
    .list {
      --row: var(--size-touch);
    }
    .search,
    .pick select,
    .dir,
    .columns summary,
    .chip,
    .columns label {
      min-block-size: var(--size-control);
    }
    .heads button {
      min-inline-size: var(--size-control);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ghead :global(.chev) {
      transition: none;
    }
  }
</style>
