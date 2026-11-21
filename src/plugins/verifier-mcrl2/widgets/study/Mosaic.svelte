<!-- A mosaic of cards (mosaic.ts): the cards tile the whole window below the mosaic's top, like a Mondrian canvas, with
     thin even gutters between them and one background behind. Drag a gutter to resize the cards on its two sides; drag a
     card by its title onto another card's edge to place it there, or onto its middle to swap the two; close a card and
     its neighbour takes the space; maximise one to the whole mosaic (Escape restores). Every drag has its keys: arrows on a
     gutter move it, arrows on a title swap the card with its neighbour. The arrangement is kept per key. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import Draggable from "../ui/components/Draggable.svelte";
  import Icon from "../ui/components/Icon.svelte";
  import Maximize from "@lucide/svelte/icons/maximize-2";
  import Minimize from "@lucide/svelte/icons/minimize-2";
  import X from "@lucide/svelte/icons/x";
  import { arrange, close, dock, keep, kept, maximise, type Mosaic, neighbour, open, place, resize, type Side, sideAt } from "./mosaic.ts";

  interface Props {
    /** Where the arrangement is kept: one key per mosaic (a study's id). */
    key: string;
    /** Every card that may be shown, with its title. */
    cards: readonly { id: string; title: string }[];
    /** The arrangement the first time, and after "arrange as first". */
    initial: Mosaic;
    card: Snippet<[string]>;
    /** More tools for a card's bar, shown always (a card's own controls). */
    tools?: Snippet<[string]>;
  }
  let { key, cards, initial, card, tools }: Props = $props();

  let m: Mosaic = $state({ root: null, closed: [], maximised: null });
  $effect.pre(() => {
    m = arrange(initial, kept(key), cards.map((c) => c.id));
  });
  const set = (next: Mosaic) => {
    m = next;
    keep(key, next);
  };
  const title = (id: string) => cards.find((c) => c.id === id)?.title ?? id;

  // ---- the space: the mosaic fills the window from where it starts
  let box: HTMLDivElement | undefined = $state();
  let w = $state(0);
  let h = $state(0);
  let top = $state(0);
  const measure = () => {
    if (box) top = box.getBoundingClientRect().top + globalThis.scrollY;
  };
  $effect(() => {
    measure();
  });
  /** The gutter's width, in CSS px: read from the spacing token, so it follows the theme's density. */
  let g = $state(10);
  $effect(() => {
    if (!box) return;
    const v = parseFloat(getComputedStyle(box).getPropertyValue("--mosaic-gutter"));
    if (Number.isFinite(v) && v > 0) g = v;
  });
  const placed = $derived(place(m, w, h, g));

  // ---- moving a card by its title
  let moving: { id: string; x0: number; y0: number; x: number; y: number } | null = $state(null);
  const target = $derived.by(() => {
    if (!moving) return null;
    for (const [id, r] of placed.cards) {
      if (id === moving.id) continue;
      if (moving.x >= r.x && moving.x <= r.x + r.w && moving.y >= r.y && moving.y <= r.y + r.h) {
        const side = sideAt(r, moving.x, moving.y);
        const p = side === "left"
          ? { ...r, w: r.w / 2 }
          : side === "right"
          ? { ...r, x: r.x + r.w / 2, w: r.w / 2 }
          : side === "top"
          ? { ...r, h: r.h / 2 }
          : side === "bottom"
          ? { ...r, y: r.y + r.h / 2, h: r.h / 2 }
          : r;
        return { id, side: side as Side, preview: p };
      }
    }
    return null;
  });
  const travel = (id: string, dx: number, dy: number, done: boolean) => {
    if (!moving || moving.id !== id) {
      const r = placed.cards.get(id)!;
      moving = { id, x0: r.x + 60, y0: r.y + 16, x: r.x + 60, y: r.y + 16 };
    }
    moving = { ...moving, x: moving.x0 + dx, y: moving.y0 + dy };
    if (done) {
      const t = target;
      if (t) set(dock(m, id, t.id, t.side));
      moving = null;
    }
  };
  const swapWith = (id: string, d: "up" | "down" | "left" | "right") => {
    const n = neighbour(m, id, d, w, h);
    if (n) set(dock(m, id, n, "center"));
  };

  const onkey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && m.maximised) set(maximise(m, m.maximised));
  };
</script>

<svelte:window onkeydown={onkey} onresize={measure} />

{#if m.closed.length > 0}
  <div class="closed" aria-label="cards closed">
    {#each m.closed as id (id)}
      <button class="reopen" onclick={() => set(open(m, id, w, h))}>+ {title(id)}</button>
    {/each}
  </div>
{/if}

<div class="mosaic" bind:this={box} bind:clientWidth={w} bind:clientHeight={h} style:--top={top}>
  {#each [...placed.cards] as [id, r] (id)}
    <section
      class="card"
      class:max={m.maximised === id}
      class:lifted={moving?.id === id}
      data-card={id}
      aria-label={title(id)}
      style:--x={r.x}
      style:--y={r.y}
      style:--w={r.w}
      style:--h={r.h}
    >
      <header class="bar">
        <span class="handle">
          <Draggable
            label={title(id)}
            moves={["left", "right", "up", "down"]}
            canMove={(d) => neighbour(m, id, d, w, h) !== null}
            onmove={(d) => swapWith(id, d)}
            ontravel={(dx, dy, done) => travel(id, dx, dy, done)}
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
  {/each}

  {#each placed.gutters as gu (gu.path)}
    <div
      class="gutter {gu.dir}"
      style:--x={gu.x}
      style:--y={gu.y}
      style:--w={gu.w}
      style:--h={gu.h}
    >
      <Draggable
        label="the divider"
        slim
        buttons={false}
        moves={gu.dir === "row" ? ["left", "right"] : ["up", "down"]}
        onmove={(d) => set(resize(m, gu.path, ratioAt(m, gu.path) + (d === "left" || d === "up" ? -0.04 : 0.04)))}
        ontravel={(dx, dy, done) => {
          if (!grab || grab.path !== gu.path) grab = { path: gu.path, ratio: ratioAt(m, gu.path) };
          set(resize(m, gu.path, grab.ratio + (gu.dir === "row" ? dx : dy) / gu.span));
          if (done) grab = null;
        }}
      />
    </div>
  {/each}

  {#if target}
    <div
      class="preview"
      style:--x={target.preview.x}
      style:--y={target.preview.y}
      style:--w={target.preview.w}
      style:--h={target.preview.h}
    ></div>
  {/if}
</div>

<script module lang="ts">
  import type { Mosaic as M, Tile } from "./mosaic.ts";
  /** The ratio of the division at a path. */
  export function ratioAt(m: M, path: string): number {
    let t: Tile | null = m.root;
    for (const c of path) {
      if (!t || "card" in t) return 0.5;
      t = c === "a" ? t.a : t.b;
    }
    return t && !("card" in t) ? t.ratio : 0.5;
  }
  let grab: { path: string; ratio: number } | null = null;
</script>

<style>
  /* The mosaic takes the whole window's width, out of the page's reading column: it is a canvas, not a page. */
  .mosaic {
    --mosaic-gutter: 10;
    position: relative;
    inline-size: calc(100vw - 2 * var(--space-md));
    margin-inline-start: calc(50% - 50vw + var(--space-md));
    block-size: calc(100dvh - var(--top) * var(--size-hairline) - var(--space-md));
    min-block-size: calc(var(--size-thumbnail-height) * 3);
  }
  .closed {
    display: flex;
    inline-size: calc(100vw - 2 * var(--space-md));
    margin-inline-start: calc(50% - 50vw + var(--space-md));
    flex-wrap: wrap;
    gap: var(--space-xs);
    margin-block-end: var(--space-sm);
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

  /* ---- a card: one flat surface on the page's background, no border and no shadow */
  /* Places are given in CSS pixels, as numbers: the hairline token is one pixel. */
  .card,
  .gutter,
  .preview {
    left: calc(var(--x) * var(--size-hairline));
    top: calc(var(--y) * var(--size-hairline));
    width: calc(var(--w) * var(--size-hairline));
    height: calc(var(--h) * var(--size-hairline));
  }
  .card {
    position: absolute;
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
    background: var(--color-surface-raised);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition:
      left var(--motion-duration-settle) var(--motion-easing-standard),
      top var(--motion-duration-settle) var(--motion-easing-standard),
      width var(--motion-duration-settle) var(--motion-easing-standard),
      height var(--motion-duration-settle) var(--motion-easing-standard);
  }
  .card.max {
    z-index: 5;
  }
  .card.lifted {
    opacity: 0.6;
  }
  @media (prefers-reduced-motion: reduce) {
    .card {
      transition: none;
    }
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    min-block-size: var(--size-target);
    padding: var(--space-xs) var(--space-sm) var(--space-none) var(--space-md);
  }
  .handle {
    flex: none;
    min-inline-size: 0;
  }
  /* The stance's Draggable, made part of the card's title: no box of its own. */
  .handle :global(.draggable) {
    padding: var(--space-none);
    gap: var(--space-xs);
    border: none;
    background: none;
  }
  .handle :global(.draggable.dragging) {
    box-shadow: none;
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
    font-family: var(--font-family-mono);
    font-size: var(--font-size-2xs);
    letter-spacing: var(--font-letter-spacing-label);
    text-transform: uppercase;
    color: var(--color-text-muted);
    white-space: nowrap;
  }
  .own {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-xs);
    min-inline-size: 0;
  }
  .tools {
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
    flex: 1;
    min-block-size: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    grid-template-columns: minmax(0, 1fr);
    overflow: auto;
    padding: var(--space-xs) var(--space-md) var(--space-md);
  }

  /* ---- a gutter: the page's background between two cards, a hairline of accent when it is grabbed */
  .gutter {
    position: absolute;
    z-index: 2;
  }
  /* The divider's handle is the whole gutter. */
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

  /* ---- where a card being moved would go */
  .preview {
    position: absolute;
    z-index: 6;
    border-radius: var(--radius-lg);
    background: var(--color-accent-soft);
    outline: var(--border-width-focus) solid var(--color-accent);
    pointer-events: none;
    transition: all var(--motion-duration-fast) var(--motion-easing-standard);
  }
</style>
