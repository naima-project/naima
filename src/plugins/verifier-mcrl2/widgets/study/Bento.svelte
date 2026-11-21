<!-- A bento (develop/models-tab.md §11): cards on a grid of twelve columns, each of a fixed size its content never
     changes, so a card that grows scrolls inside and never moves the others. The person moves a card (its handle, by
     dragging or by its arrow buttons and keys), widens or narrows it, makes it taller or shorter, folds it, and maximises
     it to the whole window and back. The arrangement is kept per key in the browser. Generic: the cards' content is the
     caller's, by snippet. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import Draggable from "../ui/components/Draggable.svelte";
  import Icon from "../ui/components/Icon.svelte";
  import Maximize from "@lucide/svelte/icons/maximize-2";
  import Minimize from "@lucide/svelte/icons/minimize-2";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import MoveHorizontal from "@lucide/svelte/icons/move-horizontal";
  import Shrink from "@lucide/svelte/icons/fold-horizontal";
  import Taller from "@lucide/svelte/icons/unfold-vertical";
  import Shorter from "@lucide/svelte/icons/fold-vertical";
  import { arrange, type Arrangement, type Card, fold, grow, keep, kept, maximise, move, moveRow, widen } from "./bento.ts";

  interface Props {
    /** Where the arrangement is kept: one key per bento (a study's id). */
    key: string;
    /** The cards, in their default order and size, each with its title. */
    cards: readonly (Card & { title: string })[];
    card: Snippet<[string]>;
  }
  let { key, cards, card }: Props = $props();

  let a: Arrangement = $state(arrange([], null));
  $effect.pre(() => {
    a = arrange(cards, kept(key));
  });
  const set = (next: Arrangement) => {
    a = next;
    keep(key, next);
  };
  const title = (id: string) => cards.find((c) => c.id === id)?.title ?? id;
  const onkey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && a.maximised) set(maximise(a, a.maximised));
  };
</script>

<svelte:window onkeydown={onkey} />

<div class="bento" class:has-max={a.maximised !== null}>
  {#each a.cards as c, i (c.id)}
    <section
      class="card"
      class:max={a.maximised === c.id}
      class:folded={c.folded}
      data-card={c.id}
      style:--span={c.span}
      style:--rows={c.rows}
      aria-label={title(c.id)}
    >
      <header class="bar">
        <Draggable
          label={title(c.id)}
          moves={["left", "right", "up", "down"]}
          canMove={(d) => (d === "left" || d === "up" ? i > 0 : i < a.cards.length - 1)}
          onmove={(d) => set(d === "left" ? move(a, c.id, -1) : d === "right" ? move(a, c.id, 1) : moveRow(a, c.id, d === "up" ? -1 : 1))}
          buttons={false}
        >
          <span class="title">{title(c.id)}</span>
        </Draggable>
        <span class="tools">
          <button class="tool" title="Narrower" aria-label="Narrower" onclick={() => set(widen(a, c.id, -1))}><Icon><Shrink /></Icon></button>
          <button class="tool" title="Wider" aria-label="Wider" onclick={() => set(widen(a, c.id, 1))}><Icon><MoveHorizontal /></Icon></button>
          <button class="tool" title="Shorter" aria-label="Shorter" onclick={() => set(grow(a, c.id, -1))}><Icon><Shorter /></Icon></button>
          <button class="tool" title="Taller" aria-label="Taller" onclick={() => set(grow(a, c.id, 1))}><Icon><Taller /></Icon></button>
          <button class="tool" title={c.folded ? "Unfold" : "Fold"} aria-label={c.folded ? "Unfold" : "Fold"} onclick={() => set(fold(a, c.id))}>
            <Icon>{#if c.folded}<ChevronDown />{:else}<ChevronUp />{/if}</Icon>
          </button>
          <button
            class="tool"
            title={a.maximised === c.id ? "Restore (Esc)" : "Maximise"}
            aria-label={a.maximised === c.id ? "Restore" : "Maximise"}
            onclick={() => set(maximise(a, c.id))}
          >
            <Icon>{#if a.maximised === c.id}<Minimize />{:else}<Maximize />{/if}</Icon>
          </button>
        </span>
      </header>
      {#if !c.folded || a.maximised === c.id}
        <div class="body">{@render card(c.id)}</div>
      {/if}
    </section>
  {/each}
</div>

<style>
  .bento {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    grid-auto-flow: row dense;
    gap: var(--space-md);
  }
  .card {
    grid-column: span var(--span);
    display: flex;
    flex-direction: column;
    block-size: calc(var(--rows) * var(--size-thumbnail-height));
    min-inline-size: 0;
    background: var(--color-surface-raised);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-raised);
    overflow: hidden;
  }
  .card.folded {
    block-size: auto;
  }
  .card.max {
    position: fixed;
    inset: var(--space-lg);
    z-index: 20;
    block-size: auto;
    box-shadow: var(--shadow-overlay);
  }
  .bento.has-max::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 19;
    background: var(--color-overlay);
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm) var(--space-xs) var(--space-md);
    border-block-end: var(--border-width-thin) solid var(--color-border);
  }
  .title {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-2xs);
    letter-spacing: var(--font-letter-spacing-label);
    text-transform: uppercase;
    color: var(--color-text-muted);
    cursor: grab;
  }
  .tools {
    display: flex;
    gap: var(--space-none);
    opacity: 0.35;
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
  /* The body has the card's size whatever it holds: a graph, a timeline or a frame fills it, anything else scrolls. */
  .body {
    flex: 1;
    min-block-size: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    grid-template-columns: minmax(0, 1fr);
    overflow: auto;
    padding: var(--space-md);
  }
  @media (max-width: 52rem) {
    .card {
      grid-column: span 12;
    }
  }
</style>
