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
  import { arrange, close, dock, keep, kept, maximise, type Mosaic, neighbour, open, resize, type Side, sideAt, type Tile } from "./mosaic.ts";

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
  }
  let { key, cards, initial, card, tools, closedRow }: Props = $props();

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

  // ---- a gutter dragged: the share of its division follows the pointer, read against the division's own box
  let grab: { path: string; ratio: number; span: number } | null = null;
  let resizing = $state(false);
  const ratioAt = (path: string): number => {
    let t: Tile | null = m.root;
    for (const c of path) {
      if (!t || "card" in t) return 0.5;
      t = c === "a" ? t.a : t.b;
    }
    return t && !("card" in t) ? t.ratio : 0.5;
  };
  let gutterEl: HTMLElement | null = null;
  const gutterTravel = (path: string, dir: "row" | "col", d: number, done: boolean) => {
    if (!grab || grab.path !== path) {
      const box = gutterEl?.parentElement?.getBoundingClientRect();
      grab = { path, ratio: ratioAt(path), span: (dir === "row" ? box?.width : box?.height) || 1 };
    }
    resizing = !done;
    set(resize(m, path, grab.ratio + d / grab.span));
    if (done) grab = null;
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
      <div class="gutter {t.dir}" onpointerdown={(e) => (gutterEl = e.currentTarget as HTMLElement)}>
        <Draggable
          label="the divider"
          slim
          buttons={false}
          moves={t.dir === "row" ? ["left", "right"] : ["up", "down"]}
          onmove={(d) => set(resize(m, path, ratioAt(path) + (d === "left" || d === "up" ? -0.04 : 0.04)))}
          ontravel={(dx, dy, done) => gutterTravel(path, t.dir, t.dir === "row" ? dx : dy, done)}
        />
      </div>
      <div class="side" style:flex-grow={1 - t.ratio}>{@render tile(t.b, `${path}b`)}</div>
    </div>
  {/if}
{/snippet}

{#if closed.length > 0}
  {#if closedRow}{@render closedRow(closed)}{:else}
    <div class="closed" aria-label="cards closed">
      {#each closed as c (c.id)}<button class="reopen" onclick={c.reopen}>+ {c.title}</button>{/each}
    </div>
  {/if}
{/if}

<div class="mosaic" class:live={resizing || target !== null}>
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
    gap: var(--space-xs);
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    opacity: 0;
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
  .gutter:hover :global(.handle),
  .gutter :global(.dragging .handle),
  .gutter :global(.handle:focus-visible) {
    background: var(--color-accent-soft);
  }
  @media (prefers-reduced-motion: reduce) {
    .side {
      transition: none;
    }
  }
</style>
