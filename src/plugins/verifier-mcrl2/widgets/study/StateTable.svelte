<!-- A model's state, readable: one row per variable, grouped as its author grouped them, each with the author's words on
     what it is. A function is drawn as the few keys where it is not its default, a list as its items, a value as itself;
     what the last step changed is marked, its old value beside it. A filter and a switch for the changed ones; a row opens
     on click to show its whole value. One of the widget set; a table of data is the same widget with other rows. -->
<script module lang="ts">
  export interface StateRow {
    name: string;
    sort?: string;
    value: unknown;
    /** Its value one step before, to mark a change. */
    prev?: unknown;
    note?: string;
    section?: string;
  }
</script>

<script lang="ts">
  interface Props {
    label: string;
    rows: readonly StateRow[];
  }
  let { label, rows }: Props = $props();

  let filter = $state("");
  let changedOnly = $state(false);
  let open: string | null = $state(null);

  type Fun = { default: unknown; at: Record<string, unknown> };
  const isFun = (v: unknown): v is Fun => !!v && typeof v === "object" && !Array.isArray(v) && "default" in v && "at" in v;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const text = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? `[${v.map(text).join(", ")}]` : JSON.stringify(v));
  const changed = (r: StateRow) => r.prev !== undefined && !same(r.prev, r.value);
  const funChanged = (r: StateRow, k: string) => isFun(r.prev) && isFun(r.value) && !same(r.prev.at[k] ?? r.prev.default, r.value.at[k]);

  const shown = $derived(
    rows.filter((r) => (!changedOnly || changed(r)) && (!filter || `${r.name} ${r.note ?? ""}`.toLowerCase().includes(filter.toLowerCase()))),
  );
  const sections = $derived.by(() => {
    const out: { title: string; rows: StateRow[] }[] = [];
    for (const r of shown) {
      const t = r.section || "the rest";
      const last = out.at(-1);
      if (last && last.title === t) last.rows.push(r);
      else out.push({ title: t, rows: [r] });
    }
    return out;
  });
  const count = $derived(rows.filter(changed).length);
  const LIMIT = 6;
</script>

<div class="table">
  <div class="tools">
    <input class="find" type="search" placeholder="Find a variable or a word" aria-label="{label}: find" bind:value={filter} />
    <button class="switch" aria-pressed={changedOnly} onclick={() => (changedOnly = !changedOnly)}>
      <span class="knob"></span>changed by the last step{count ? ` · ${count}` : ""}
    </button>
  </div>
  <div class="rows" role="table" aria-label={label}>
    {#each sections as sec (sec.title)}
      <p class="section">{sec.title}</p>
      {#each sec.rows as r (r.name)}
        {@const ch = changed(r)}
        <div
          class="row"
          class:ch
          class:open={open === r.name}
          role="row"
          tabindex="0"
          onclick={() => (open = open === r.name ? null : r.name)}
          onkeydown={(e) => e.key === "Enter" && (open = open === r.name ? null : r.name)}
        >
          <div class="name" role="rowheader">
            {#if ch}<span class="mark" title="changed by the last step"></span>{/if}
            <span class="id">{r.name}</span>
            {#if r.sort}<span class="sort">{r.sort}</span>{/if}
            {#if r.note}<span class="note">{r.note}</span>{/if}
          </div>
          <div class="value" role="cell">
            {#if isFun(r.value)}
              {@const keys = Object.keys(r.value.at)}
              {#if keys.length === 0}
                <span class="quiet">{text(r.value.default)} everywhere</span>
              {:else}
                <div class="map">
                  {#each open === r.name ? keys : keys.slice(0, LIMIT) as k (k)}
                    <span class="k" class:kch={funChanged(r, k)}>{k}</span><span class="v" class:kch={funChanged(r, k)}>{text(r.value.at[k])}</span>
                  {/each}
                  {#if open !== r.name && keys.length > LIMIT}<span class="more">and {keys.length - LIMIT} more</span>{/if}
                  <span class="quiet otherwise">otherwise {text(r.value.default)}</span>
                </div>
              {/if}
            {:else if Array.isArray(r.value)}
              {#if r.value.length === 0}<span class="quiet">empty</span>{:else}
                <span class="items">{#each r.value as x, i (i)}<span class="item">{text(x)}</span>{/each}</span>
              {/if}
            {:else}
              <span class="scalar">{text(r.value)}</span>
              {#if ch}<span class="was">was {text(r.prev)}</span>{/if}
            {/if}
          </div>
        </div>
      {/each}
    {/each}
    {#if shown.length === 0}<p class="quiet empty">{changedOnly ? "The last step changed nothing." : "No variable matches."}</p>{/if}
  </div>
</div>

<style>
  .table {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    block-size: 100%;
    min-block-size: 0;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-sm);
    align-items: center;
  }
  .find {
    flex: 1 1 calc(var(--size-target) * 6);
    min-inline-size: 0;
    min-block-size: var(--size-target);
    padding: var(--space-none) var(--space-md);
    font: inherit;
    font-size: var(--font-size-sm);
    color: var(--color-text);
    background: var(--color-surface-soft);
    border: var(--border-width-thin) solid var(--color-border-soft);
    border-radius: var(--radius-full);
  }
  .find:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
    border-color: var(--color-accent);
  }
  .switch {
    display: inline-flex;
    align-items: center;
    gap: var(--space-sm);
    min-block-size: var(--size-target);
    padding: var(--space-none) var(--space-sm);
    font: inherit;
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    background: none;
    border: var(--border-width-thin) solid transparent;
    cursor: pointer;
  }
  .switch:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
  }
  .knob {
    position: relative;
    inline-size: calc(var(--space-md) * 2);
    block-size: var(--space-md);
    border-radius: var(--radius-full);
    background: var(--color-border-strong);
    transition: background var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .knob::after {
    content: "";
    position: absolute;
    inset-block: var(--border-width-focus);
    inset-inline-start: var(--border-width-focus);
    aspect-ratio: 1;
    border-radius: var(--radius-full);
    background: var(--color-surface-raised);
    transition: transform var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .switch[aria-pressed="true"] {
    color: var(--color-text);
  }
  .switch[aria-pressed="true"] .knob {
    background: var(--color-accent);
  }
  .switch[aria-pressed="true"] .knob::after {
    transform: translateX(100%);
  }
  .rows {
    flex: 1;
    min-block-size: 0;
    overflow: auto;
  }
  .section {
    position: sticky;
    top: 0;
    z-index: 1;
    margin: 0;
    padding: var(--space-sm) var(--space-none) var(--space-xs);
    font-family: var(--font-family-mono);
    font-size: var(--font-size-2xs);
    letter-spacing: var(--font-letter-spacing-label);
    text-transform: uppercase;
    color: var(--color-text-muted);
    background: var(--color-surface-raised);
  }
  /* The name and the value side by side, two shares and three, until there is not room for both: then one over the other. */
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs) var(--space-md);
    align-content: center;
    min-block-size: var(--size-target);
    padding: var(--space-xs) var(--space-sm);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .row:hover,
  .row:focus-visible {
    background: var(--color-accent-tint);
  }
  .row:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
    outline-offset: calc(-1 * var(--border-width-focus));
  }
  .row.ch {
    background: var(--color-accent-tint);
  }
  /* On the tint of a changed row, or of the row under the pointer, the quiet words are the page's own ink. */
  .row.ch :is(.sort, .note, .was, .k:not(.kch), .quiet, .more),
  .row:hover :is(.sort, .note, .was, .k:not(.kch), .quiet, .more) {
    color: var(--color-text);
  }
  .name {
    flex: 2 1 var(--size-w-8);
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-none) var(--space-sm);
    min-inline-size: 0;
  }
  .mark {
    align-self: center;
    inline-size: var(--space-xs);
    block-size: var(--space-xs);
    border-radius: var(--radius-full);
    background: var(--color-accent);
  }
  .id {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-xs);
    color: var(--color-text);
  }
  .sort {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-2xs);
    color: var(--color-text-muted);
  }
  .note {
    flex-basis: 100%;
    font-size: var(--font-size-xs);
    line-height: var(--font-line-height-normal);
    color: var(--color-text-muted);
  }
  .value {
    flex: 3 1 var(--size-w-12);
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-none) var(--space-sm);
    min-inline-size: 0;
    font-family: var(--font-family-mono);
    font-size: var(--font-size-xs);
    color: var(--color-text);
    overflow-wrap: anywhere;
  }
  .map,
  .items {
    flex: 1 1 100%;
  }
  .map {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-none) var(--space-sm);
  }
  .k {
    color: var(--color-text-muted);
  }
  .kch {
    color: var(--color-accent);
  }
  .more,
  .otherwise {
    grid-column: 1 / -1;
  }
  .items {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
  }
  .item {
    padding: var(--space-none) var(--space-xs);
    border-radius: var(--radius-sm);
    background: var(--color-surface-soft);
  }
  .quiet,
  .more {
    color: var(--color-text-muted);
  }
  .was {
    color: var(--color-text-muted);
    text-decoration: line-through;
  }
  .empty {
    padding: var(--space-md);
    font-family: var(--font-family-body);
  }
  /* With more contrast asked for, the quiet words are the page's own ink and the tint under a row gives way to its edge. */
  @media (prefers-contrast: more) {
    .sort,
    .note,
    .k,
    .quiet,
    .more,
    .was,
    .section,
    .switch {
      color: var(--color-text);
    }
    .row:hover,
    .row.ch {
      background: none;
    }
    .row.ch {
      outline: var(--border-width-thin) solid var(--color-text);
    }
    .item {
      background: none;
      outline: var(--border-width-thin) solid var(--color-border-strong);
    }
  }
  @media (pointer: coarse) {
    .find,
    .switch,
    .row {
      min-block-size: var(--size-control);
    }
  }
</style>
