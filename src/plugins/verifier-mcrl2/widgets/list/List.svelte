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
     reckoned from its count. Quiet (`quiet`), its controls fold into one status line of words ("267 items · no filter
     · not grouped · as listed"), each part a quiet link, the slice the list was opened on first (`slice`); a small
     search glyph opens the search in place, and Adjust unfolds every control (the filters, the grouping, the sort, the
     columns) in a sheet under the line. The filters are of three kinds: the values of a facet (kind, state, person),
     the spans of days of a range (when it was filed, told, closed: Any time, the last 7, 30 or 90 days), and the words
     searched; all of them one `view`. A grouping by day (dayGrouping) draws a chapter heading over the days of each
     month; `compact` draws a thinner row, and the spec's `second` a quiet second line under the title. The diary look
     (`look="diary"`), for what a person reads as a story (the Diary on Home): a group by day is a dated section under one
     fixed date column (the group's title over its `sub`), the items the spec calls margin notes recede into one quiet
     line after the day's entries, the chapters (months) are large light headings that fold, a past one into a teaser of
     what it held (the grouping's `teaser`), all of one size scale with a measure of about 65 characters; beside an item
     open it is a column of dates, the open day marked. The spans of days, filters, sort, saved views and the keyboard
     are the same as in the table look. One of the widget set, beside Action and Segmented. -->
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
    appliedView,
    cellText,
    clearFilters,
    type Column,
    dropView,
    type DayRange,
    EMPTY_VIEW,
    filtersOn,
    headId,
    lastDays,
    type ListSpec,
    type ListView,
    listModel,
    move,
    type Place,
    pickView,
    placeId,
    regroup,
    rowId,
    type SavedView,
    saveView,
    setRange,
    sideways,
    sortBy,
    SPANS,
    spanWords,
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
    /** The views kept under a name; bind it to keep them (per project, by the caller). With none bound, the list offers
     *  no views. */
    saved?: SavedView[];
    /** The controls folded into one status line of words, unfolded by Adjust. */
    quiet?: boolean;
    /** What the list was opened on, said first on the status line: "bugs · waiting for you". */
    slice?: string;
    /** One thinner line a row, for a long list read at a glance. */
    compact?: boolean;
    /** The table (columns, a row each) or the diary (entries as prose under dated headings, chapters as months). */
    look?: "table" | "diary";
    /** The scrolling box of the rows, for a screen that scrolls the list by itself. */
    grid?: HTMLDivElement;
    /** An item pointed at or focused, by key, or none (null). */
    onpoint?: (key: string | null) => void;
    /** The group (a day's key) the screen reads at, its date drawn in the colour of now. */
    reading?: string;
    /** What an item is called on the status line, in one and in many: "item", "items". */
    noun?: readonly [string, string];
    /** Today, yyyy-mm-dd, for the spans of days ("Last 7 days") and the day headings ("Today"); the clock's when left out. */
    today?: string;
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
    saved = $bindable(),
    quiet = false,
    slice = "",
    compact = false,
    today = "",
    look = "table",
    grid = $bindable(),
    onpoint,
    reading = "",
    noun = ["item", "items"],
  }: Props = $props();
  const diary = $derived(look === "diary");
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const now = $derived(today || ((d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`)(new Date()));

  /** Each kind of column's track: the title takes the room left, the others a width of their own (a token), the same in
   *  every row, so that every row lines up without measuring anything. */
  const TRACK = { grow: "minmax(0, 1fr)", fit: "var(--size-w-8)", narrow: "var(--size-w-5)" } as const;
  const uid = $props.id();
  const narrow = $derived(column ?? open !== null);
  const model = $derived(listModel(items, spec, view));
  const grouped = $derived(!!view.group && !!spec.groupings?.some((g) => g.id === view.group));
  const chaptered = $derived(grouped && model.groups.some((g) => g.chapter));
  const second = $derived(!narrow && spec.second ? spec.second : null);
  const byKey = $derived(new Map(items.map((i) => [spec.key(i), i])));
  const cols = $derived(
    diary ? (model.columns as Column<T>[]).filter((c) => c.width === "grow") : narrow ? (model.columns as Column<T>[]).filter((c) => c.column) : (model.columns as Column<T>[]),
  );
  const title = $derived(cols.find((c) => c.width === "grow"));
  const tracks = $derived(
    [mark && !diary ? "var(--dot)" : "", ...cols.map((c) => TRACK[c.width ?? "fit"])].filter(Boolean).join(" "),
  );

  // The cursor: where the person put it, kept on what is drawn as the rows change (list.ts afterChange).
  let put = $state<string | null>(null);
  const cursor = $derived(afterChange(model.places, put, open));
  /** The place the Tab key enters the list at: the cursor, else the first place drawn. */
  const entry = $derived(cursor ?? (model.places[0] ? placeId(model.places[0]) : null));
  let filtering = $state(false);
  let search = $state<HTMLInputElement>();

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
        if (quiet && !narrow) void openSearch();
        else search?.focus();
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
  // ---- Quiet: the status line, its sheet of controls and its search in place.
  let adjusting = $state(false);
  let searching = $state(false);
  const lower = (w: string) => w.charAt(0).toLowerCase() + w.slice(1);
  const counted = $derived(model.shown === model.total ? `${model.total} ${model.total === 1 ? noun[0] : noun[1]}` : `${model.shown} of ${model.total}`);
  const rangeWords = $derived(
    (spec.ranges ?? []).flatMap((r) => (view.ranges?.[r.id] ? [`${lower(r.label)} ${spanWords(view.ranges[r.id]!, now)}`] : [])),
  );
  const filterWords = $derived(
    [...model.facets.flatMap((f) => f.chips.filter((c) => c.on).map((c) => lower(c.label))), ...rangeWords].join(", ") || "no filter",
  );
  const hasFilters = $derived(!!spec.facets?.length || !!spec.ranges?.length);
  /** The span chosen for a range is one of the spans offered, by its days; 0 for none chosen. */
  const spanOn = (id: string, days: number) => {
    const r = view.ranges?.[id];
    return days === 0 ? !r : !!r && lastDays(days, now).from === r.from && r.to === now;
  };
  const pickSpan = (id: string, days: number) => (view = setRange(view, id, days === 0 ? null : lastDays(days, now)));
  const groupWords = $derived.by(() => {
    const g = (spec.groupings ?? []).find((x) => x.id === view.group);
    return g ? `grouped by ${lower(g.label)}` : "not grouped";
  });
  const sortWords = $derived.by(() => {
    const c = spec.columns.find((x) => x.id === view.sort);
    return c ? `sorted by ${lower(c.label)}${view.desc ? ", descending" : ""}` : "as listed";
  });
  // ---- Views kept under a name: pick one, keep the one on the page under a name, drop one.
  const applied = $derived(saved ? appliedView(saved, view) : null);
  let naming = $state(false);
  let named = $state("");
  let nameBox = $state<HTMLInputElement>();
  async function startNaming() {
    named = "";
    naming = true;
    await tick();
    nameBox?.focus();
  }
  function keep() {
    if (!saved || !named.trim()) return;
    saved = saveView(saved, named, view);
    naming = false;
  }
  async function openSearch() {
    searching = true;
    await tick();
    search?.focus();
  }
  const ariaSort = (c: Column<T>) => (view.sort === c.id ? (view.desc ? "descending" : "ascending") : undefined);
</script>

{#snippet diaryRow(item: T, as: "entry" | "note")}
  {@const key = spec.key(item)}
  {@const id = rowId(key)}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="row {as}"
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
    onpointerenter={() => onpoint?.(key)}
    onpointerleave={() => onpoint?.(null)}
    onfocus={() => onpoint?.(key)}
    onblur={() => onpoint?.(null)}
  >
    {#each cols as c (c.id)}
      <span class="cell title" role="gridcell" data-col={c.id}>{cellText(c, item)}</span>
    {/each}
  </div>
{/snippet}

<section class="list" class:narrow class:is-diary={diary} data-look={look} class:compact class:has-second={!!second} aria-label={label} data-part="list">
  {#snippet searchBox()}
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
        onblur={(e) => {
          if (quiet && !e.currentTarget.value) searching = false;
        }}
      />
    </label>
  {/snippet}
  {#snippet facetRows(all: boolean)}
      {#each model.facets as f (f.id)}
        {@const chips = all ? f.chips : f.chips.filter((c) => c.on)}
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
  {/snippet}
  {#snippet rangeRows()}
    {#each spec.ranges ?? [] as r (r.id)}
      {@const custom = view.ranges?.[r.id] && !SPANS.some((x) => spanOn(r.id, x.days))}
      <div class="facet" role="group" aria-label={r.label} data-part="list-range">
        <span class="flabel">{r.label}</span>
        {#each SPANS as s (s.days)}
          <button class="chip" class:on={spanOn(r.id, s.days)} type="button" aria-pressed={spanOn(r.id, s.days)} onclick={() => pickSpan(r.id, s.days)}>{s.label}</button>
        {/each}
        {#if custom}<button class="chip on" type="button" aria-pressed="true" title="Take this span off" onclick={() => pickSpan(r.id, 0)}>{spanWords(view.ranges![r.id]!, now)}</button>{/if}
      </div>
    {/each}
  {/snippet}
  {#snippet viewsRow()}
    {#if saved}
      <div class="facet views" role="group" aria-label="Views" data-part="list-views">
        <span class="flabel">Views</span>
        {#each saved as s (s.name)}
          <span class="vchip" class:on={applied === s.name}>
            <button class="vpick" type="button" aria-pressed={applied === s.name} onclick={() => (view = pickView(saved ?? [], s.name, view))}>{s.name}</button>
            <button class="vdrop" type="button" aria-label="Delete the view {s.name}" title="Delete the view" onclick={() => (saved = dropView(saved ?? [], s.name))}><X class="glyph" aria-hidden="true" /></button>
          </span>
        {/each}
        {#if naming}
          <input
            bind:this={nameBox}
            class="vname"
            type="text"
            placeholder="Name this view"
            aria-label="Name for the view"
            bind:value={named}
            onkeydown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                keep();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                naming = false;
              }
            }}
            onblur={() => (naming = false)}
          />
        {:else}
          <button class="chip" type="button" data-part="list-save-view" disabled={applied !== null} onclick={startNaming}>Save this view</button>
        {/if}
      </div>
    {/if}
  {/snippet}
  {#if quiet && !narrow}
    <!-- Quiet: one status line of words, each a way to the controls; the search a small glyph that opens in place. -->
    <div class="status" data-part="list-status">
      {#if searching || view.search}
        {@render searchBox()}
      {:else}
        <button class="st-glyph" type="button" aria-label="Search {label} (/)" title="Search (/)" onclick={openSearch}><Search class="glyph" aria-hidden="true" /></button>
      {/if}
      <p class="st-line" aria-live="polite">
        {#if slice}<span class="st-slice">{slice}</span><span class="st-sep" aria-hidden="true">·</span>{/if}
        {#if applied}<span class="st-slice" data-part="list-applied">{applied}</span><span class="st-sep" aria-hidden="true">·</span>{/if}
        <span class="st-count">{counted}</span>
        {#if hasFilters && !(diary && filterWords === "no filter")}<span class="st-sep" aria-hidden="true">·</span><button class="st-part" type="button" aria-label="Filters: {filterWords}. Adjust" onclick={() => (adjusting = true)}>{filterWords}</button>{/if}
        {#if spec.groupings?.length}<span class="st-sep" aria-hidden="true">·</span><button class="st-part" type="button" aria-label="{groupWords}. Adjust" onclick={() => (adjusting = true)}>{groupWords}</button>{/if}
        {#if !(diary && !view.sort)}<span class="st-sep" aria-hidden="true">·</span><button class="st-part" type="button" aria-label="{sortWords}. Adjust" onclick={() => (adjusting = true)}>{sortWords}</button>{/if}
      </p>
      <button class="st-adjust" type="button" data-part="list-adjust" aria-expanded={adjusting} onclick={() => (adjusting = !adjusting)}>
        <SlidersHorizontal class="glyph" aria-hidden="true" />{adjusting ? "Done" : "Adjust"}
      </button>
    </div>
    {#if adjusting}
      <!-- The sheet: every control the line stands for, the filters with every value and its count. -->
      <div class="sheet" data-part="list-sheet">
        <div class="bar">
    {#if !narrow}
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
        </div>
        {#if hasFilters}
          <div class="facets" role="group" aria-label="Filters">
            {@render facetRows(true)}
            {@render rangeRows()}
            {#if filtersOn(view)}<Action label="Clear filters" icon={X} size="sm" onclick={() => (view = clearFilters(view))} />{/if}
          </div>
        {/if}
        {@render viewsRow()}
      </div>
    {/if}
  {:else}
  <div class="bar">
    {@render searchBox()}
    {#if !narrow}
      {#if hasFilters}
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
      {@render facetRows(filtering)}
      {#if filtering}{@render rangeRows()}{/if}
      {#if filtersOn(view)}<Action label="Clear filters" icon={X} size="sm" onclick={() => (view = clearFilters(view))} />{/if}
    </div>
  {/if}
  {#if !narrow}{@render viewsRow()}{/if}
  {/if}

  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div class="grid" role="treegrid" aria-label={label} aria-rowcount={model.shown} style:--tracks={tracks} bind:this={grid} onkeydown={keys} tabindex={-1}>
    {#if !narrow && !diary}
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
    {#if diary}
      <!-- The diary look: chapters (months), dated sections (the groups, days), entries as prose, notes after them. -->
      {#each model.groups as g, gi (g.key)}
        {#if chaptered && g.chapter && g.chapter.key !== model.groups[gi - 1]?.chapter?.key}
          {@const ch = g.chapter}
          {@const shut = view.folded.includes(ch.key)}
          {@const parts = /^(.*) (\d{4})$/.exec(ch.title)}
          {@const teaser = shut ? (spec.groupings?.find((x) => x.id === view.group)?.teaser?.(model.groups.filter((x) => x.chapter?.key === ch.key).flatMap((x) => [...x.items])) ?? []) : []}
          <div class="chapter" role="row" aria-level={1} data-part="list-chapter" data-chapter={ch.key} data-head={ch.key}>
            <span class="cell" role="gridcell">
              <button class="chead" type="button" aria-expanded={!shut} onclick={() => (view = toggleFold(view, ch.key))}>
                <ChevronRight class="chev" aria-hidden="true" />
                <span class="ctitle">{parts ? parts[1] : ch.title}</span>{#if parts}<span class="gsub">{parts[2]}</span>{/if}
              </button>
              {#each teaser as line, n (n)}<span class="teaser">{line}</span>{/each}
            </span>
          </div>
        {/if}
        {#if !g.hidden}
          {@const id = headId(g.key)}
          {@const entries = g.items.filter((i) => !spec.margin?.(i))}
          {@const notes = g.items.filter((i) => spec.margin?.(i))}
          <div
            class="group day"
            role="rowgroup"
            class:only={!entries.length}
            class:folded={g.folded}
            class:open={open !== null && g.items.some((i) => spec.key(i) === open)}
            data-day={g.key}
            data-reading={reading !== "" && reading === g.key ? "true" : undefined}
          >
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="ghead when"
              role="row"
              id={domId(id)}
              aria-level={chaptered ? 2 : 1}
              aria-expanded={!g.folded}
              tabindex={entry === id ? 0 : -1}
              class:cursor={cursor === id}
              onclick={() => {
                put = id;
                const first = g.items[0];
                if (narrow && first) onopen?.(spec.key(first));
                else view = toggleFold(view, g.key);
              }}
            >
              <span class="cell" role="rowheader"><span class="wd" class:sr={narrow}>{g.title}</span>{#if g.sub}<span class="wn">{g.sub}</span>{/if}</span>
            </div>
            {#if !g.folded}
              <div class="said" class:sr={narrow}>
                {#each entries as item (spec.key(item))}
                  {@render diaryRow(item, "entry")}
                {/each}
                {#if notes.length}
                  <div class="notes">
                    {#each notes as item (spec.key(item))}
                      {@render diaryRow(item, "note")}
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    {:else}
    {#each model.groups as g, gi (g.key)}
      {#if chaptered && g.chapter && g.chapter.key !== model.groups[gi - 1]?.chapter?.key}
        <div class="chapter" role="row" aria-level={1} data-part="list-chapter" data-chapter={g.chapter.key}>
          <span class="cell" role="gridcell"><span class="ctitle">{g.chapter.title}</span></span>
        </div>
      {/if}
      <div class="group" role="rowgroup" class:long={g.count >= 50} class:folded={g.folded} style:--n={g.folded ? 0 : g.count}>
        {#if grouped}
          {@const id = headId(g.key)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="ghead"
            role="row"
            id={domId(id)}
            aria-level={chaptered ? 2 : 1}
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
              aria-level={grouped ? (chaptered ? 3 : 2) : 1}
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
                <span class="cell" role="gridcell" class:title={c === title} class:end={c.align === "end"} data-col={c.id}>{cellText(c, item)}{#if second && c === title}{@const more = second(item)}{#if more}<span class="second" data-part="list-second">{more}</span>{/if}{/if}</span>
              {/each}
            </div>
          {/each}
        {/if}
      </div>
    {/each}
    {/if}
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

  /* ---- Quiet: the status line, words in the muted grey, each part darker under a pointer; Adjust at its end. */
  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs) var(--space-md);
    min-block-size: var(--size-target);
    color: var(--color-text-muted);    /* Never shrunk under its own words (a narrow stage, the text at 200%): the grid below takes what is left. */
    flex: none;
  }
  .status .search {
    flex: 0 1 var(--size-w-16);
  }
  .st-line {
    display: flex;
    flex: 1 1 auto;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 var(--space-sm);
    margin: 0;
    min-inline-size: 0;
  }
  .st-slice,
  .st-count {
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }
  .st-sep {
    color: var(--color-border-strong);
  }
  .st-part,
  .st-glyph,
  .st-adjust {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    min-block-size: var(--size-target);
    padding: 0;
    border: var(--border-width-thin) solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-thickness: var(--border-width-thin);
    text-decoration-color: transparent;
    text-underline-offset: var(--space-xs);
  }
  .st-glyph {
    justify-content: center;
    min-inline-size: var(--size-target);
  }
  .st-glyph :global(.glyph),
  .vdrop :global(.glyph),
  .st-adjust :global(.glyph) {
    inline-size: var(--size-icon);
    block-size: var(--size-icon);
  }
  .st-adjust {
    margin-inline-start: auto;
    text-decoration: none;
  }
  @media (hover: hover) {
    .st-part:hover,
    .st-glyph:hover,
    .st-adjust:hover {
      color: var(--color-text);
      text-decoration-color: var(--color-border-strong);
    }
  }
  .st-part:focus-visible,
  .st-glyph:focus-visible,
  .st-adjust:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
  }
  .st-adjust[aria-expanded="true"] {
    color: var(--color-text);
  }
  /* The sheet: the controls on the page's raised ground, a hairline around, unfolding under the line. */
  .sheet {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-md) var(--space-lg);
    border: var(--border-width-thin) solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
  }
  @media (prefers-reduced-motion: no-preference) {
    .sheet {
      animation: sheet var(--motion-duration-normal) var(--motion-easing-standard);
    }
  }
  @keyframes sheet {
    from {
      opacity: 0;
      transform: translateY(calc(var(--space-xs) * -1));
    }
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
  /* A view kept: its name picks it, a small cross drops it. */
  .vchip {
    display: inline-flex;
    align-items: center;
    border: var(--border-width-thin) solid var(--color-border-soft);
    border-radius: var(--radius-full);
  }
  .vchip.on {
    color: var(--color-on-accent);
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
  .vpick,
  .vdrop {
    display: inline-flex;
    align-items: center;
    min-block-size: var(--size-target);
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    cursor: pointer;
  }
  .vpick {
    padding: var(--space-none) var(--space-sm);
  }
  .vdrop {
    padding: var(--space-none) var(--space-sm) var(--space-none) var(--space-none);
    opacity: 0.6;
  }
  @media (hover: hover) {
    .vdrop:hover {
      opacity: 1;
    }
  }
  @media (pointer: coarse) {
    .vdrop {
      opacity: 1;
      min-inline-size: var(--size-touch);
      justify-content: center;
    }
    .vpick,
    .vdrop {
      min-block-size: var(--size-touch);
    }
  }
  .vpick:focus-visible,
  .vdrop:focus-visible,
  .vname:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
  }
  .vname {
    min-block-size: var(--size-target);
    padding: var(--space-none) var(--space-sm);
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface);
    border: var(--border-width-thin) solid var(--color-border);
    border-radius: var(--radius-full);
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
  .compact {
    --row: calc(var(--size-target) * 0.75);
  }
  .has-second {
    --row: calc(var(--size-target) * 1.5);
  }
  .heads,
  .row,
  .ghead {
    display: grid;
    grid-template-columns: var(--tracks);
    column-gap: var(--space-md);
  }
  /* A long group off the screen is not drawn; its height is reckoned from its count of rows and its heading, with the space
     the heading keeps above it, so that drawing it later moves nothing. A short group is always drawn: its rows can wrap
     to more lines than the reckoning allows for (a large text size), and a group reckoned too short lies over the next. */
  .group.long {
    content-visibility: auto;
    contain-intrinsic-size: auto calc((var(--n) + 1) * var(--row) + var(--space-sm));
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
    overflow-wrap: anywhere;
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

  /* A chapter's heading, over the groups of a month or a year: larger and quiet, never folded. */
  .chapter {
    margin-block-start: var(--space-md);
    padding-block-end: var(--space-xs);
    border-block-end: var(--border-width-thin) solid var(--color-border-soft);
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--color-text);
  }
  .chapter .cell {
    grid-column: 1 / -1;
  }
  .chapter + .group .ghead {
    margin-block-start: var(--space-xs);
  }
  /* A second line under the title: smaller and muted. */
  .row .cell.title .second {
    display: block;
    overflow-wrap: anywhere;
    font-size: var(--font-size-xs);
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

  /* A list in a narrow container (a phone, a text at 200%, a narrow pane): the title takes a line of its own and wraps, the
     other columns follow on the line below it, so that no word is cut and no column lies over another. The column
     headings give way to the Sort menu. */
  @container (max-width: 48rem) {
    .list:not(.narrow):not(.is-diary) .heads {
      display: none;
    }
    /* A group's heading is one cell over the whole width: the columns' tracks, summed, can be wider than the room. */
    .list:not(.narrow):not(.is-diary) .ghead {
      grid-template-columns: minmax(0, 1fr);
    }
    .list:not(.narrow):not(.is-diary) .row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      column-gap: var(--space-md);
      row-gap: 0;
      padding-block: var(--space-xs);
    }
    .list:not(.narrow):not(.is-diary) .row .cell {
      flex: 0 1 auto;
      min-inline-size: 0;
    }
    .list:not(.narrow):not(.is-diary) .row .cell.title {
      order: -1;
    }
    .list:not(.narrow):not(.is-diary) .row .dotcell {
      order: -2;
      flex: none;
      align-self: center;
      inline-size: var(--dot);
    }
    .list:not(.narrow):not(.is-diary) .row .cell.title {
      flex: 1 1 60%;
    }
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
  /* ---- The diary look: a page to read. One size scale (label, caption, reading, heading, title), the house sans-serif,
     a measure of about 65 characters, air between days; the chapter a large light month, the date one fixed column the
     same for every day, the entries prose, the routine a quiet note in the margin under the date. Flat, nothing scrolls
     a transform; the soft motion is a colour and a turn of the chevron, both off under reduced motion. */
  .is-diary .grid {
    gap: 0;
  }
  .is-diary .group {
    content-visibility: visible;
    contain-intrinsic-size: none;
  }
  /* A chapter: a large light month, a button that folds it into a teaser. */
  .is-diary .chapter {
    /* One cell over the whole width: the columns' tracks, summed, can be wider than the room. */
    grid-template-columns: minmax(0, 1fr);
    margin-block: var(--space-lg) var(--space-xs);
    padding: 0;
    border: 0;
    font-weight: var(--font-weight-regular);
  }
  .is-diary .chapter .cell {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-xs);
    overflow: visible;
    white-space: normal;
  }
  .chead {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-sm) var(--space-sm) 0;
    border: var(--border-width-thin) solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    font: inherit;
    color: var(--color-text);
    cursor: pointer;
  }
  .chead:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
  }
  .chead :global(.chev) {
    align-self: center;
    inline-size: var(--size-icon);
    block-size: var(--size-icon);
    color: var(--color-text-muted);
    transform: rotate(90deg);
    transition: transform var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .chead[aria-expanded="false"] :global(.chev) {
    transform: none;
  }
  .ctitle {
    font-size: var(--font-size-title);
    font-weight: var(--font-weight-light);
    letter-spacing: var(--font-letter-spacing-title);
    line-height: var(--font-line-height-tight);
  }
  .gsub {
    color: var(--color-text-muted);
    font-size: var(--font-size-heading);
    font-weight: var(--font-weight-light);
    margin-inline-start: var(--space-sm);
  }
  /* The date heading of a day, the group's head: not a chevron and a count, the date itself. */
  .is-diary .ghead.when {
    display: block;
    min-block-size: 0;
    margin: 0;
    padding: 0;
    font-weight: var(--font-weight-regular);
  }
  /* A chapter folded tells what it holds: its decisions, in the words of the entries, quieter. */
  .teaser {
    display: block;
    max-inline-size: var(--size-w-39-5);
    padding-inline-start: calc(var(--size-icon) + var(--space-sm));
    color: var(--color-text-muted);
    font-size: var(--font-size-home-caption);
    line-height: var(--font-line-height-home-caption);
  }
  /* A day: its date in one column of one width, its entries beside it, its notes after them. */
  .day {
    display: grid;
    grid-template-columns: var(--size-ledger-when) minmax(0, var(--size-w-39-5));
    column-gap: var(--space-home-line);
    padding-block: var(--space-md);
  }
  /* Narrower than the dates and the entries can share (about 320 px at a text size of 200%): the date stands over its entries. */
  @container (inline-size < 17rem) {
    .day {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .when {
    align-self: start;
  }
  .when .cell {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    overflow: visible;
    color: var(--color-text-muted);
  }
  .wd {
    font-size: var(--font-size-home-label);
    letter-spacing: var(--font-letter-spacing-label);
    line-height: var(--font-line-height-home-caption);
    text-transform: uppercase;
  }
  .wn {
    color: var(--color-text);
    font-size: var(--font-size-heading);
    font-variant-numeric: tabular-nums;
    line-height: var(--font-line-height-tight);
  }
  .day[data-reading="true"] .wn {
    color: var(--color-home-now-text);
  }
  .said {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    min-inline-size: 0;
  }
  .is-diary .row.entry {
    display: block;
    min-block-size: 0;
    margin-inline: calc(var(--space-sm) * -1) 0;
    padding: var(--space-xs) 0 var(--space-xs) var(--space-sm);
  }
  .is-diary .row.entry .cell.title {
    display: block;
    overflow: visible;
    overflow-wrap: anywhere;
    white-space: normal;
    color: var(--color-text);
    font-size: var(--font-size-reading);
    line-height: var(--font-line-height-home-caption);
  }
  .is-diary .row:hover,
  .is-diary .row.open {
    background: none;
  }
  .is-diary .row:hover .cell.title,
  .is-diary .row:focus-visible .cell.title {
    color: var(--color-home-now-text);
  }
  .is-diary .row.open .cell.title {
    color: var(--color-home-now-text);
  }
  /* The routine of a day (what landed, what was filed) is a quiet note after its entries, never an entry. */
  .notes {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 var(--space-md);
  }
  .is-diary .row.note {
    display: block;
    min-block-size: 0;
    padding: 0;
  }
  .is-diary .row.note .cell.title {
    display: block;
    overflow: visible;
    /* A note is a line of its own and wraps only when the room is short (a wide face, the text at 200%). */
    overflow-wrap: anywhere;
    color: var(--color-home-faint);
    font-size: var(--font-size-home-label);
    line-height: var(--font-line-height-home-caption);
  }
  .is-diary .row.note:hover .cell.title,
  .is-diary .row.note:focus-visible .cell.title {
    color: var(--color-text-muted);
  }
  /* A day with only routine is one quiet line, level with the bottom of its date. */
  .day.only .said {
    align-self: end;
  }
  @media (pointer: coarse) {
    .is-diary .row.note,
    .is-diary .ghead.when {
      min-block-size: var(--size-touch);
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .is-diary .cell.title,
    .ctitle,
    .wn {
      transition: color var(--motion-duration-fast) var(--motion-easing-standard);
    }
  }
  /* Beside an item open: the chapters and days keep their order in a narrow column of dates, the open day marked by the
     segment on the column's hairline. */
  .narrow.is-diary .day {
    position: relative;
    grid-template-columns: minmax(0, 1fr);
    padding-block: var(--space-xs);
  }
  .narrow.is-diary .when {
    cursor: pointer;
  }
  .narrow.is-diary .day.open .when .cell {
    color: var(--color-home-now-text);
  }
  .narrow.is-diary .day.open::after {
    content: "";
    position: absolute;
    inset-block: var(--space-xs);
    inset-inline-end: 0;
    inline-size: var(--border-width-focus);
    border-radius: var(--radius-full);
    background: var(--color-accent);
  }
  /* The entries stay for the keyboard and the screen reader, out of sight: the column is of dates. */
  .narrow.is-diary .said {
    position: absolute;
    inline-size: var(--border-width-thin);
    block-size: var(--border-width-thin);
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .narrow.is-diary .when .cell {
    flex-direction: row;
    align-items: baseline;
    gap: var(--space-xs);
  }
  .narrow.is-diary .wn {
    font-size: var(--font-size-home-caption);
    color: inherit;
  }
  .narrow.is-diary .wd {
    position: absolute;
    inline-size: var(--border-width-thin);
    block-size: var(--border-width-thin);
    overflow: hidden;
    clip-path: inset(50%);
  }
  .narrow.is-diary .chapter {
    margin-block-start: var(--space-md);
  }
  .narrow.is-diary .chead {
    padding-block: var(--space-xs);
  }
  .narrow.is-diary .ctitle {
    font-size: var(--font-size-home-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: normal;
  }
  .narrow.is-diary .gsub {
    font-size: var(--font-size-home-label);
  }
  .narrow.is-diary .teaser {
    display: none;
  }
</style>
