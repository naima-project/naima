<!-- A mosaic of cards (mosaic.ts): the cards tile the whole box the mosaic is given, like a Mondrian canvas, with thin
     even gutters between them and one background behind. It is drawn as nested flex boxes, one per division of the
     tree, each side growing by its share: the browser lays it out, nothing is measured or computed for it. Drag a
     gutter to resize the cards on its two sides; drag a card by its title onto another card's edge to place it there,
     or onto its middle to swap the two; close a card and its neighbour takes the space; maximise one to the whole mosaic
     (Escape restores). Every drag has its keys: arrows on a gutter move it, arrows on a title swap the card with the one
     before or after it. A card shows its content and its own few actions; its handle, maximise and close appear when
     the pointer or the focus is on it. The cards closed, and the way back to the first arrangement, are in one quiet
     Layout menu in the row above, which the page may share with its own title (`lead`) and links (`trail`). The
     arrangement is kept per key. The mosaic fills its parent, which must give it a height (a
     flex column, for one). -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import Draggable from "../Draggable.svelte";
  import Icon from "../Icon.svelte";
  import Maximize from "@lucide/svelte/icons/maximize-2";
  import Minimize from "@lucide/svelte/icons/minimize-2";
  import X from "@lucide/svelte/icons/x";
  import Plus from "@lucide/svelte/icons/plus";
  import Menu, { type Entry } from "./Menu.svelte";
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
    /** What the row above the mosaic starts with: the page's title, say. */
    lead?: Snippet;
    /** What the row above the mosaic ends with, after the Layout menu: a link out, say. */
    trail?: Snippet;
    /** Notes of the page closed by the person, offered again in the Layout menu with the closed cards. */
    notes?: { title: string; says: string; reopen: () => void }[];
  }
  let { key, cards, initial, card, tools, lead, trail, notes = [] }: Props = $props();

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
  const layoutSays = $derived(closed.length + notes.length > 0 ? `Layout · ${closed.length + notes.length} closed` : "Layout");
  /** The Layout menu: every card back when one fills the window, the cards and notes closed, the first arrangement. */
  const layout = $derived.by((): Entry[] => [
    ...(m.maximised ? [{ label: "Show every card (Esc)", onselect: () => set(maximise(m, m.maximised!)) }] : []),
    ...[...closed.map((c) => ({ label: c.title, onselect: c.reopen })), ...notes.map((n) => ({ label: n.title, onselect: n.reopen }))].map((e, i) => ({
      ...e,
      icon: Plus,
      ...(i === 0 ? { group: "Closed", rule: !!m.maximised } : {}),
    })),
    { label: "Reset the layout", onselect: () => set(initial), rule: true },
  ]);

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
  // A junction, through its Draggable: every divider meeting there and every one on their lines; its first travel is
  // the press.
  const junctionTravel = (paths: string[], dx: number, dy: number, done: boolean) => {
    if (!base) {
      if (drag.over !== "JUNCTION") step("enter_junction");
      if (!step("press")) return;
      begin(paths);
    }
    travel(dx, dy);
    if (done) finish("release");
  };
  const hoverJunction = (paths: string[], on: boolean) => {
    if (drag.drag !== "NONE") return;
    step(on ? "enter_junction" : "leave");
    lit = on ? new Set(paths) : new Set();
  };
  // The keys: on a junction, the arrows move its set a step.
  const junctionStep = (paths: string[], d: "up" | "down" | "left" | "right") => {
    const x = d === "left" ? -1 : d === "right" ? 1 : 0;
    const y = d === "up" ? -1 : d === "down" ? 1 : 0;
    set(moveDividers(m, paths, { x: x * 0.02, y: y * 0.02 }, false));
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
      <!-- The press only starts a drag of the card: the handle inside it has the keys and the accessible name. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
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
    <!-- A card whose contents scroll is reached by keyboard through its body. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="body" role="region" tabindex="0" aria-label="{title(id)}: contents">{@render card(id)}</div>
  </section>
{/snippet}

{#snippet tile(t: Tile, path: string)}
  {#if "card" in t}
    {@render cardOf(t.card)}
  {:else}
    <div class="split {t.dir}" style:--a="{t.ratio * 100}fr" style:--b="{(1 - t.ratio) * 100}fr">
      <div class="side">{@render tile(t.a, `${path}a`)}</div>
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
              role="presentation"
              title="Drag to move every divider meeting here, and those on the same lines"
              onpointerenter={() => hoverJunction(jn.moves, true)}
              onpointerleave={() => hoverJunction(jn.moves, false)}
            >
              <Draggable
                label={`the ${jn.meeting.length} dividers meeting here and the ${jn.moves.length - jn.meeting.length} aligned with them`}
                slim
                buttons={false}
                moves={["left", "right", "up", "down"]}
                onmove={(d) => junctionStep(jn.moves, d)}
                ontravel={(dx, dy, done) => junctionTravel(jn.moves, dx, dy, done)}
              />
            </span>
          {/if}
        {/each}
      </div>
      <div class="side">{@render tile(t.b, `${path}b`)}</div>
    </div>
  {/if}
{/snippet}

<!-- The row above the mosaic: the page's own lead, the Layout menu, the page's trail. A card is moved by its title and
     resized by the gaps between cards, which the menu's trigger says on hover. -->
<div class="top">
  {#if lead}<div class="lead">{@render lead()}</div>{/if}
  <span class="layout">
    <Menu
      label={layoutSays}
      text={layoutSays}
      hint="Drag a card by its title to move it, and the gap between two cards to resize them"
      entries={layout}
    />
  </span>
  {#if trail}{@render trail()}{/if}
</div>

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
    display: grid;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-xs) var(--space-md);
  }
  .lead {
    flex: 1 1 auto;
    min-inline-size: 0;
  }
  .layout {
    margin-inline-start: auto;
  }

  /* ---- the divisions: flex boxes whose sides grow by their shares; nothing is placed by hand */
  /* Each division is a grid of its two sides and the gutter between them. The sides share what room there is by their
     ratio; given no height, the grid takes the height its contents need, at the same ratio. */
  .split {
    display: grid;
    min-block-size: 0;
    min-inline-size: 0;
    transition: grid-template-columns var(--motion-duration-fast) var(--motion-easing-standard), grid-template-rows var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .split.row {
    grid-template: minmax(0, 1fr) / minmax(0, var(--a)) auto minmax(0, var(--b));
  }
  .split.col {
    grid-template: minmax(0, var(--a)) auto minmax(0, var(--b)) / minmax(0, 1fr);
  }
  .side {
    display: grid;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    min-block-size: 0;
    min-inline-size: 0;
  }
  .mosaic.live .split {
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
    flex-wrap: nowrap;
    align-items: center;
    gap: var(--space-sm);
    min-block-size: var(--size-target);
    padding: var(--space-xs) var(--space-sm) var(--space-none) var(--space-md);
  }
  /* The title gives way first: it ends in an ellipsis, the card's tools always stay inside it. */
  .handle {
    flex: 0 1 auto;
    min-inline-size: 0;
  }
  .handle :global(.draggable) {
    flex-wrap: nowrap;
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
    opacity: 0;
    transition: opacity var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .handle :global(.handle:focus-visible) {
    opacity: 1;
  }
  .title {
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: var(--font-size-sm);
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
    flex-wrap: nowrap;
    justify-content: flex-end;
    opacity: 0;
    transition: opacity var(--motion-duration-fast) var(--motion-easing-standard);
  }
  /* The card's chrome (its handle, maximise and close) appears when the focus is in the card or the pointer over it; where
     nothing hovers (a finger), or more contrast is asked for, it always shows. A maximised card shows its Restore. */
  .card:focus-within .tools,
  .card:focus-within .handle :global(.handle),
  .card.max .tools {
    opacity: 1;
  }
  @media (hover: hover) {
    .card:hover .handle :global(.handle),
    .card:hover .tools {
      opacity: 1;
    }
  }
  @media (hover: none), (prefers-contrast: more) {
    .handle :global(.handle),
    .tools {
      opacity: 1;
    }
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
    border: var(--border-width-thin) solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .tool:hover {
    color: var(--color-accent);
  }
  .tool:focus-visible,
  .body:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
  }
  .body {
    flex: 1 1 0%;
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
    --j: calc(3 * var(--space-sm));
    position: absolute;
    z-index: 2;
    inline-size: var(--j);
    block-size: var(--j);
    border-radius: var(--radius-full);
    cursor: move;
    touch-action: none;
  }
  .gutter.row .junction {
    inset-inline-start: calc((var(--space-sm) - var(--j)) / 2);
  }
  .gutter.row .junction.start {
    inset-block-start: calc(-2 * var(--j) / 3);
  }
  .gutter.row .junction.end {
    inset-block-end: calc(-2 * var(--j) / 3);
  }
  .gutter.col .junction {
    inset-block-start: calc((var(--space-sm) - var(--j)) / 2);
  }
  .gutter.col .junction.start {
    inset-inline-start: calc(-2 * var(--j) / 3);
  }
  .gutter.col .junction.end {
    inset-inline-end: calc(-2 * var(--j) / 3);
  }
  .junction::after {
    content: "";
    position: absolute;
    inset: calc(50% - var(--space-xs));
    border-radius: var(--radius-full);
    background: transparent;
    pointer-events: none;
  }
  .junction:hover::after,
  .junction:focus-within::after {
    background: var(--color-accent-soft);
  }
  .gutter.row {
    inline-size: var(--space-sm);
  }
  .gutter.col {
    block-size: var(--space-sm);
  }
  /* The gutter is thin, and its handle is wider than it: a target of the least size, centred on it and lying a little
     over the two cards' edges, wider still under a finger. */
  .gutter :global(.draggable) {
    --reach: var(--size-target);
    position: absolute;
    display: grid;
    padding: var(--space-none);
    border: none;
    background: none;
  }
  .gutter.row :global(.draggable) {
    inset-block: 0;
    inset-inline-start: calc(50% - var(--reach) / 2);
    inline-size: var(--reach);
  }
  .gutter.col :global(.draggable) {
    inset-inline: 0;
    inset-block-start: calc(50% - var(--reach) / 2);
    block-size: var(--reach);
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
  /* A junction's Draggable: its whole square the handle, which draws no pill of its own (the junction's dot is it). */
  .gutter .junction :global(.draggable) {
    position: absolute;
    inset: 0;
  }
  .gutter .junction :global(.handle) {
    cursor: move;
  }
  .gutter .junction :global(.handle)::after {
    display: none;
  }
  /* Under a finger every target is a whole control. */
  @media (pointer: coarse) {
    .tool,
    .handle :global(.handle) {
      min-inline-size: var(--size-control);
      min-block-size: var(--size-control);
    }
    .gutter :global(.draggable) {
      --reach: var(--size-control);
    }
    .junction {
      --j: var(--size-control);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .split {
      transition: none;
    }
  }
</style>
