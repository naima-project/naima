<!-- A mosaic of cards (mosaic.ts): the cards tile the whole box the mosaic is given, like a Mondrian canvas, with thin
     even gutters between them and one background behind. It is drawn as nested flex boxes, one per division of the
     tree, each side growing by its share: the browser lays it out, nothing is measured or computed for it. Drag a
     gutter to resize the cards on its two sides; drag a card by its title onto another card's edge to place it there,
     or onto its middle to swap the two; close a card and its neighbour takes the space; maximise one to the whole mosaic
     (Escape restores). Every drag has its keys: arrows on a gutter move it, arrows on a title swap the card with the one
     before or after it. The arrangement is kept per key. The mosaic fills its parent, which must give it a height (a
     flex column, for one). -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import Draggable from "../ui/components/Draggable.svelte";
  import Icon from "../ui/components/Icon.svelte";
  import Maximize from "@lucide/svelte/icons/maximize-2";
  import Minimize from "@lucide/svelte/icons/minimize-2";
  import X from "@lucide/svelte/icons/x";
  import {
    arrange,
    close,
    dock,
    DRAG_IDLE,
    type DragEvent,
    type DragState,
    dragStep,
    junctionAt,
    keep,
    kept,
    maximise,
    type Mosaic,
    moveDividers,
    neighbour,
    open,
    resize,
    type Side,
    sideAt,
    type Tile,
  } from "./mosaic.ts";

  interface Props {
    /** Where the arrangement is kept: one key per mosaic (a study's id). */
    key: string;
    /** Every card that may be shown, with its title. */
    cards: readonly { id: string; title: string }[];
    /** The arrangement the first time. */
    initial: Mosaic;
    card: Snippet<[string]>;
    /** More tools for a card's bar, shown always (a card's own controls). */
    tools?: Snippet<[string]>;
    /** Where the closed cards are offered again: given, the mosaic leaves that row to its owner. */
    closedRow?: Snippet<[{ id: string; title: string; reopen: () => void }[]]>;
    /** Notes of the page closed by the person, offered again in the same row as the closed cards. */
    notes?: { title: string; says: string; reopen: () => void }[];
  }
  let { key, cards, initial, card, tools, closedRow, notes = [] }: Props = $props();

  let m: Mosaic = $state({ root: null, closed: [], maximised: null });
  $effect.pre(() => {
    m = arrange(initial, kept(key), cards.map((c) => c.id));
  });
  const set = (next: Mosaic) => {
    m = next;
    keep(key, next);
  };
  const title = (id: string) => cards.find((c) => c.id === id)?.title ?? id;
  const closed = $derived(m.closed.map((id) => ({ id, title: title(id), reopen: () => set(open(m, id)) })));

  // ---- a divider or a junction dragged (mosaic.ts): the drag machine says what a press drags; the dividers move by the
  // pointer's travel over the mosaic, read once when the drag starts, each from where it stood then, snapping to aligned
  // lines. Hover lights what a press would move: the one divider, or a junction's whole set.
  let mosaicEl: HTMLElement | undefined = $state();
  const ratioAt = (path: string): number => {
    let t: Tile | null = m.root;
    for (const c of path) {
      if (!t || "card" in t) return 0.5;
      t = c === "a" ? t.a : t.b;
    }
    return t && !("card" in t) ? t.ratio : 0.5;
  };
  let drag: DragState = $state(DRAG_IDLE);
  let lit: ReadonlySet<string> = $state(new Set());
  let resizing = $state(false);
  const step = (e: DragEvent): boolean => {
    const next = dragStep(drag, e);
    if (next) drag = next;
    return next !== null;
  };
  let base: { m: Mosaic; w: number; h: number; paths: string[] } | null = null;
  const begin = (paths: string[]) => {
    const box = mosaicEl?.getBoundingClientRect();
    base = { m, w: box?.width || 1, h: box?.height || 1, paths };
    resizing = true;
  };
  const travel = (dx: number, dy: number) => {
    if (!base) return;
    step("move");
    set(moveDividers(base.m, base.paths, { x: dx / base.w, y: dy / base.h }));
  };
  const finish = (e: "release" | "cancel") => {
    if (e === "cancel" && base) set(base.m);
    step(e);
    base = null;
    resizing = false;
    if (drag.over === "NOTHING") lit = new Set();
  };
  // A divider by itself, through its Draggable: its first travel is the press.
  const gutterTravel = (path: string, dir: "row" | "col", d: number, done: boolean) => {
    if (!base) {
      if (drag.over !== "DIVIDER") step("enter_divider");
      if (!step("press")) return;
      begin([path]);
    }
    travel(dir === "row" ? d : 0, dir === "col" ? d : 0);
    if (done) finish("release");
  };
  const hoverDivider = (path: string, on: boolean) => {
    if (drag.drag !== "NONE") return;
    step(on ? "enter_divider" : "leave");
    lit = on ? new Set([path]) : new Set();
  };
  // A junction: every divider meeting there and every one on their lines.
  let start: { x: number; y: number; id: number } | null = null;
  const junctionDown = (e: PointerEvent, paths: string[]) => {
    if (drag.over !== "JUNCTION") step("enter_junction");
    if (!step("press")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    begin(paths);
    e.preventDefault();
  };
  const junctionMove = (e: PointerEvent) => {
    if (start && e.pointerId === start.id) travel(e.clientX - start.x, e.clientY - start.y);
  };
  const junctionUp = (e: PointerEvent, how: "release" | "cancel") => {
    if (!start || e.pointerId !== start.id) return;
    start = null;
    finish(how);
  };
  const hoverJunction = (paths: string[], on: boolean) => {
    if (drag.drag !== "NONE") return;
    step(on ? "enter_junction" : "leave");
    lit = on ? new Set(paths) : new Set();
  };
  // The keys: on a junction, the arrows move its set a step, as a press, a move and a release.
  const junctionKey = (e: KeyboardEvent, paths: string[]) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    set(moveDividers(m, paths, { x: d[0]! * 0.02, y: d[1]! * 0.02 }, false));
  };

  // ---- a card dragged by its title: where it would go is read from the page under the pointer at that moment
  let moving: { id: string; x: number; y: number } | null = null;
  let target: { id: string; side: Side } | null = $state(null);
  const press = (id: string, e: PointerEvent) => (moving = { id, x: e.clientX, y: e.clientY });
  const cardTravel = (id: string, dx: number, dy: number, done: boolean) => {
    if (!moving || moving.id !== id) return;
    const x = moving.x + dx;
    const y = moving.y + dy;
    const under = document.elementsFromPoint(x, y).map((e) => e.closest<HTMLElement>("[data-card]")).find((e) => e && e.dataset["card"] !== id);
    if (under) {
      const r = under.getBoundingClientRect();
      target = { id: under.dataset["card"]!, side: sideAt((x - r.left) / r.width, (y - r.top) / r.height) };
    } else target = null;
    if (done) {
      if (target) set(dock(m, id, target.id, target.side));
      target = null;
      moving = null;
    }
  };

  const onkey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && m.maximised) set(maximise(m, m.maximised));
  };
</script>

<svelte:window onkeydown={onkey} />

{#snippet cardOf(id: string)}
  <section class="card" class:max={m.maximised === id} data-card={id} data-drop={target?.id === id ? target.side : undefined} aria-label={title(id)}>
    <header class="bar">
      <span class="handle" onpointerdown={(e) => press(id, e)}>
        <Draggable
          label={title(id)}
          moves={["left", "right", "up", "down"]}
          canMove={(d) => neighbour(m, id, d) !== null}
          onmove={(d) => {
            const n = neighbour(m, id, d);
            if (n) set(dock(m, id, n, "center"));
          }}
          ontravel={(dx, dy, done) => cardTravel(id, dx, dy, done)}
          buttons={false}
        >
          <span class="title">{title(id)}</span>
        </Draggable>
      </span>
      <span class="own">{@render tools?.(id)}</span>
      <span class="tools">
        <button class="tool" aria-label={m.maximised === id ? "Restore" : "Maximise"} title={m.maximised === id ? "Restore (Esc)" : "Maximise"} onclick={() => set(maximise(m, id))}>
          <Icon>{#if m.maximised === id}<Minimize />{:else}<Maximize />{/if}</Icon>
        </button>
        <button class="tool" aria-label="Close {title(id)}" title="Close" onclick={() => set(close(m, id))}><Icon><X /></Icon></button>
      </span>
    </header>
    <div class="body">{@render card(id)}</div>
  </section>
{/snippet}

{#snippet tile(t: Tile, path: string)}
  {#if "card" in t}
    {@render cardOf(t.card)}
  {:else}
    <div class="split {t.dir}">
      <div class="side" style:flex-grow={t.ratio}>{@render tile(t.a, `${path}a`)}</div>
      <div class="gutter {t.dir}" role="presentation" class:lit={lit.has(path)} onpointerenter={() => hoverDivider(path, true)} onpointerleave={() => hoverDivider(path, false)}>
        <Draggable
          label="the divider"
          slim
          buttons={false}
          moves={t.dir === "row" ? ["left", "right"] : ["up", "down"]}
          onmove={(d) => set(resize(m, path, ratioAt(path) + (d === "left" || d === "up" ? -0.04 : 0.04)))}
          ontravel={(dx, dy, done) => gutterTravel(path, t.dir, t.dir === "row" ? dx : dy, done)}
        />
        <!-- Where this divider meets others, a handle that moves all of them, and every divider on their lines. -->
        {#each ["start", "end"] as const as end (end)}
          {@const jn = junctionAt(m.root, path, end)}
          {#if jn}
            <span
              class="junction {end}"
              class:cross={jn.cross}
              role="slider"
              tabindex="0"
              aria-label={`where ${jn.meeting.length} dividers meet: drag to move them and the ${jn.moves.length - jn.meeting.length} aligned with them`}
              aria-valuenow={Math.round((t.dir === "row" ? jn.x : jn.y) * 100)}
              title="Drag to move every divider meeting here, and those on the same lines"
              onpointerenter={() => hoverJunction(jn.moves, true)}
              onpointerleave={() => hoverJunction(jn.moves, false)}
              onpointerdown={(e) => junctionDown(e, jn.moves)}
              onpointermove={junctionMove}
              onpointerup={(e) => junctionUp(e, "release")}
              onpointercancel={(e) => junctionUp(e, "cancel")}
              onlostpointercapture={(e) => junctionUp(e, "release")}
              onkeydown={(e) => junctionKey(e, jn.moves)}
            ></span>
          {/if}
        {/each}
      </div>
      <div class="side" style:flex-grow={1 - t.ratio}>{@render tile(t.b, `${path}b`)}</div>
    </div>
  {/if}
{/snippet}

{#if closedRow && closed.length > 0}{@render closedRow(closed)}{:else}
  <!-- The row above the mosaic: the cards closed, to bring back, what a maximised card means, and the way back to the
       first arrangement. A card is moved by its title, resized by the gaps between cards. -->
  <div class="closed" aria-label="the cards">
    {#if m.maximised}
      <span class="say">{title(m.maximised)} fills the window: Esc, or Restore at its top right, brings the other cards back.</span>
    {:else if closed.length > 0 || notes.length > 0}
      <span class="say">Closed, a click brings it back:</span>
      {#each notes as n (n.title)}<button class="reopen" title={`Show ${n.says} again`} onclick={n.reopen}>+ {n.title}</button>{/each}
      {#each closed as c (c.id)}<button class="reopen" onclick={c.reopen}>+ {c.title}</button>{/each}
    {:else}
      <span class="say">Drag a card by its title to move it, and the gap between two cards to resize them.</span>
    {/if}
    <button class="reopen reset" title="Every card back where it was first, open" onclick={() => set(initial)}>Reset the layout</button>
  </div>
{/if}

<div class="mosaic" class:live={resizing || target !== null} bind:this={mosaicEl}>
  {#if m.maximised}
    {@render cardOf(m.maximised)}
  {:else if m.root}
    {@render tile(m.root, "")}
  {/if}
</div>

<style>
  .mosaic {
    flex: 1 1 auto;
    min-block-size: 0;
    min-inline-size: 0;
    display: flex;
  }
  .closed {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs);
  }
  .say {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }
  .reset {
    margin-inline-start: auto;
    border-style: solid;
  }
  .reopen {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-2xs);
    letter-spacing: var(--font-letter-spacing-label);
    text-transform: uppercase;
    min-block-size: var(--size-target);
    padding: var(--space-none) var(--space-sm);
    color: var(--color-text-muted);
    background: none;
    border: var(--border-width-thin) dashed var(--color-border-strong);
    border-radius: var(--radius-full);
    cursor: pointer;
  }
  .reopen:hover {
    color: var(--color-accent);
    border-color: var(--color-accent);
  }

  /* ---- the divisions: flex boxes whose sides grow by their shares; nothing is placed by hand */
  .split {
    flex: 1 1 0;
    display: flex;
    min-block-size: 0;
    min-inline-size: 0;
  }
  .split.col {
    flex-direction: column;
  }
  .side {
    flex-basis: 0;
    flex-shrink: 1;
    display: flex;
    min-block-size: 0;
    min-inline-size: 0;
    transition: flex-grow var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .mosaic.live .side {
    transition: none;
  }

  /* ---- a card: one flat surface on the page's background, no border and no shadow */
  .card {
    position: relative;
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
    min-block-size: 0;
    background: var(--color-surface-raised);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  /* Where a card being moved would go: half of the target for an edge, all of it for a swap. */
  .card[data-drop]::after {
    content: "";
    position: absolute;
    z-index: 6;
    border-radius: var(--radius-lg);
    background: var(--color-accent-soft);
    outline: var(--border-width-focus) solid var(--color-accent);
    pointer-events: none;
    inset: 0;
  }
  .card[data-drop="left"]::after {
    inset-inline-end: 50%;
  }
  .card[data-drop="right"]::after {
    inset-inline-start: 50%;
  }
  .card[data-drop="top"]::after {
    inset-block-end: 50%;
  }
  .card[data-drop="bottom"]::after {
    inset-block-start: 50%;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    min-block-size: var(--size-target);
    padding: var(--space-xs) var(--space-sm) var(--space-none) var(--space-md);
  }
  /* The title gives way first: it ends in an ellipsis, the card's tools always stay inside it. */
  .handle {
    flex: 0 1 auto;
    min-inline-size: 0;
    overflow: hidden;
  }
  .handle :global(.draggable) {
    padding: var(--space-none);
    gap: var(--space-xs);
    border: none;
    background: none;
  }
  .handle :global(.draggable.dragging) {
    box-shadow: none;
  }
  .handle :global(.content) {
    min-inline-size: 0;
    overflow: hidden;
  }
  .handle :global(.handle) {
    min-inline-size: var(--size-target);
    min-block-size: var(--size-target);
    padding: var(--space-none);
    opacity: 0.35;
  }
  .card:hover .handle :global(.handle),
  .handle :global(.handle:focus-visible) {
    opacity: 1;
  }
  .title {
    display: block;
    overflow-wrap: anywhere;
    font-family: var(--font-family-mono);
    font-size: var(--font-size-2xs);
    letter-spacing: var(--font-letter-spacing-label);
    text-transform: uppercase;
    color: var(--color-text-muted);
  }
  .own {
    flex: 1 1 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-xs);
    min-inline-size: 0;
  }
  .tools {
    flex: none;
    display: flex;
    opacity: 0.45;
    transition: opacity var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .card:hover .tools,
  .card:focus-within .tools {
    opacity: 1;
  }
  .tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-inline-size: var(--size-target);
    min-block-size: var(--size-target);
    padding: var(--space-none);
    color: var(--color-text-muted);
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .tool:hover {
    color: var(--color-accent);
  }
  .body {
    flex: 1 1 0;
    min-block-size: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    grid-template-columns: minmax(0, 1fr);
    overflow: auto;
    padding: var(--space-xs) var(--space-md) var(--space-md);
  }

  /* ---- a gutter: the page's background between two cards, its whole width the handle, a tint when it is grabbed */
  .gutter {
    flex: none;
    display: grid;
    position: relative;
  }
  /* A junction's handle: a square three gutters wide centred where the dividers meet, over the gutters there. */
  .junction {
    position: absolute;
    z-index: 2;
    inline-size: calc(3 * var(--space-sm));
    block-size: calc(3 * var(--space-sm));
    border-radius: var(--radius-full);
    cursor: move;
    touch-action: none;
  }
  .gutter.row .junction {
    inset-inline-start: calc(-1 * var(--space-sm));
  }
  .gutter.row .junction.start {
    inset-block-start: calc(-2 * var(--space-sm));
  }
  .gutter.row .junction.end {
    inset-block-end: calc(-2 * var(--space-sm));
  }
  .gutter.col .junction {
    inset-block-start: calc(-1 * var(--space-sm));
  }
  .gutter.col .junction.start {
    inset-inline-start: calc(-2 * var(--space-sm));
  }
  .gutter.col .junction.end {
    inset-inline-end: calc(-2 * var(--space-sm));
  }
  .junction::after {
    content: "";
    position: absolute;
    inset: calc(50% - var(--space-xs));
    border-radius: var(--radius-full);
    background: transparent;
  }
  .junction:hover::after,
  .junction:focus-visible::after {
    background: var(--color-accent-soft);
  }
  .junction:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
  }
  .gutter.row {
    inline-size: var(--space-sm);
  }
  .gutter.col {
    block-size: var(--space-sm);
  }
  .gutter :global(.draggable) {
    display: grid;
    inline-size: 100%;
    block-size: 100%;
    padding: var(--space-none);
    border: none;
    background: none;
  }
  .gutter :global(.content) {
    display: none;
  }
  .gutter :global(.handle) {
    inline-size: 100%;
    block-size: 100%;
    min-inline-size: 0;
    min-block-size: 0;
    padding: var(--space-none);
    border-radius: var(--radius-full);
  }
  .gutter.row :global(.handle) {
    cursor: col-resize;
  }
  .gutter.col :global(.handle) {
    cursor: row-resize;
  }
  .gutter :global(.grip) {
    display: none;
  }
  /* The bar lit on hover and drag: a thin rounded pill in the gutter's middle, apart from the cards on both sides and
     short of both ends; the whole gutter stays the handle. */
  .gutter :global(.handle) {
    position: relative;
  }
  .gutter :global(.handle)::after {
    content: "";
    position: absolute;
    border-radius: var(--radius-full);
    background: transparent;
    transition: background var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .gutter.row :global(.handle)::after {
    inset-block: 18%;
    inset-inline: calc(50% - var(--border-width-focus));
  }
  .gutter.col :global(.handle)::after {
    inset-inline: 18%;
    inset-block: calc(50% - var(--border-width-focus));
  }
  .gutter:hover :global(.handle)::after,
  .gutter.lit :global(.handle)::after,
  .gutter :global(.dragging .handle)::after,
  .gutter :global(.handle:focus-visible)::after {
    background: var(--color-accent-soft);
  }
  @media (prefers-reduced-motion: reduce) {
    .side {
      transition: none;
    }
  }
</style>
