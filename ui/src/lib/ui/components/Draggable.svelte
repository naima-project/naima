<!-- Something that can be moved by dragging, and always also without dragging. It is the only place in a project
     where pointer dragging is handled (the no-raw-drag check refuses it anywhere else), so that every drag has the
     single-pointer alternative WCAG 2.2 asks for (SC 2.5.7).

     `moves` is required and never empty: the directions the thing can move in. Each one is a button next to it, and an
     arrow key on its handle, so dragging is only ever a shortcut. A drag reports one move each time the pointer has
     travelled the thing's own height (or width), so dragging a row of a list by one row moves it by one place. What a
     move means is the caller's, through `onmove`; whether it can happen now is `canMove`. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import Button from "./Button.svelte";

  type Direction = "up" | "down" | "left" | "right";

  interface Props {
    /** What is moved, as people call it: "Apples". The handle and the buttons are named after it. */
    label: string;
    /** The directions it can move in, never none: each is a button and an arrow key as well as a drag. */
    moves: readonly [Direction, ...Direction[]];
    /** Whether a move can happen now; a move that cannot is a disabled button and is never reported. */
    canMove?: (direction: Direction) => boolean;
    onmove: (direction: Direction) => void;
    children: Snippet;
  }

  let { label, moves, canMove = () => true, onmove, children }: Props = $props();

  const KEYS: Record<string, Direction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
  const WORDS: Record<Direction, string> = { up: "Up", down: "Down", left: "Left", right: "Right" };
  const vertical = (d: Direction) => d === "up" || d === "down";

  let root: HTMLElement | undefined = $state();
  /** Where the pointer was when the last move was reported, while a drag lasts: this component's own UI state. */
  let origin: { x: number; y: number; id: number } | null = $state(null);

  function move(direction: Direction) {
    if (moves.includes(direction) && canMove(direction)) onmove(direction);
  }

  function onpointerdown(event: PointerEvent) {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    origin = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }

  function onpointermove(event: PointerEvent) {
    if (!origin || event.pointerId !== origin.id || !root) return;
    const box = root.getBoundingClientRect();
    const dy = event.clientY - origin.y;
    const dx = event.clientX - origin.x;
    if (Math.abs(dy) >= box.height && box.height > 0) {
      move(dy > 0 ? "down" : "up");
      origin = { ...origin, y: origin.y + Math.sign(dy) * box.height };
    } else if (Math.abs(dx) >= box.width && box.width > 0) {
      move(dx > 0 ? "right" : "left");
      origin = { ...origin, x: origin.x + Math.sign(dx) * box.width };
    }
  }

  function onpointerup() {
    origin = null;
  }

  function onkeydown(event: KeyboardEvent) {
    const direction = KEYS[event.key];
    if (!direction || !moves.includes(direction)) return;
    event.preventDefault();
    move(direction);
  }

  const keys = $derived(
    moves.map((d) => Object.entries(KEYS).find(([, v]) => v === d)?.[0]).filter(Boolean).join(" "),
  );
</script>

<div class="draggable" class:dragging={origin !== null} bind:this={root} role="group" aria-label={label}>
  <button
    type="button"
    class="handle"
    aria-label="Move {label}"
    aria-keyshortcuts={keys}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    onpointercancel={onpointerup}
    {onkeydown}
  >
    <span aria-hidden="true">⠿</span>
  </button>
  <div class="content">{@render children()}</div>
  <div class="moves">
    {#each moves as direction (direction)}
      <Button
        variant="ghost"
        aria-label="Move {label} {direction}"
        disabled={!canMove(direction)}
        onclick={() => move(direction)}
      >
        {WORDS[direction]}
      </Button>
    {/each}
  </div>
</div>

<style>
  .draggable {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs);
    border: var(--border-width-thin) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
  }
  .dragging {
    border-color: var(--color-accent);
    box-shadow: var(--shadow-raised);
  }
  .handle {
    min-width: var(--size-control);
    min-height: var(--size-control);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    font: inherit;
    cursor: grab;
    touch-action: none;
  }
  .dragging .handle {
    cursor: grabbing;
  }
  .handle:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
    outline-offset: 0;
  }
  .content {
    flex: 1;
    min-width: 0;
  }
  .moves {
    display: flex;
    gap: var(--space-xs);
  }
</style>
