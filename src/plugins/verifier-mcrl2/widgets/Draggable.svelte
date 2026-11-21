<!-- Something that can be moved by dragging, and always also without dragging. It is the only place in a project
     where pointer dragging is handled (the no-raw-drag check refuses it anywhere else), so that every drag has the
     single-pointer alternative WCAG 2.2 asks for (SC 2.5.7).

     `moves` is required and never empty: the directions the thing can move in. Each one is a button next to it, and an
     arrow key on its handle, so dragging is only ever a shortcut. A drag reports one move each time the pointer has
     travelled the thing's own height (or width), so dragging a row of a list by one row moves it by one place. What a
     move means is the caller's, through `onmove`; whether it can happen now is `canMove`. Given `ontravel`, a drag reports
     instead how far the pointer has travelled since the press, at every move and at the release, for something that
     follows the pointer smoothly, such as an edge being resized; the buttons and the arrow keys still move it by steps.
     `slim` draws it as a thin bar across its container: the handle is the whole bar with a small grip at its middle,
     the buttons small at its end. Given `onpress`, a press released before the pointer travels 4 CSS px (and Enter or
     Space on the handle) is a click, reported through it, and no travel is reported; `buttons` false leaves the step
     buttons out, for a handle whose owner gives the same moves another way without dragging. -->
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
    /** The pointer's travel since the press, in CSS px, at every move of a drag and at its release (done). */
    ontravel?: (dx: number, dy: number, done: boolean) => void;
    /** A thin bar across its container, such as the edge of a panel that can be resized. */
    slim?: boolean;
    /** A click on the handle: a press that did not travel, or Enter or Space. */
    onpress?: () => void;
    /** Draw the step buttons; false only where the owner gives the same moves another way without dragging. */
    buttons?: boolean;
    children?: Snippet;
  }

  let { label, moves, canMove = () => true, onmove, ontravel, slim = false, onpress, buttons = true, children }: Props = $props();
  /** Where the press was, for a drag reported as travel. */
  let start: { x: number; y: number } | null = null;
  /** How far a press may travel, in CSS px, and still be a click, when the handle is also pressed. */
  const SLOP = 4;
  /** Whether the press under way has travelled past the slop, and whether the click it ends with is swallowed. */
  let travelled = false;
  let swallow = false;

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
    start = { x: event.clientX, y: event.clientY };
    travelled = false;
  }

  function onpointermove(event: PointerEvent) {
    if (!origin || event.pointerId !== origin.id || !root) return;
    if (ontravel && start) {
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (!travelled && onpress && Math.hypot(dx, dy) < SLOP) return;
      travelled = true;
      ontravel(dx, dy, false);
      return;
    }
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

  function onpointerup(event: PointerEvent) {
    if (ontravel && start && origin && event.pointerId === origin.id && (travelled || !onpress)) {
      ontravel(event.clientX - start.x, event.clientY - start.y, true);
    }
    swallow = travelled;
    travelled = false;
    origin = null;
    start = null;
  }

  /** The click a press ends with: a press that travelled was a drag, and its click is swallowed. */
  function onclick() {
    if (swallow) swallow = false;
    else onpress?.();
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

<div class="draggable" class:slim class:dragging={origin !== null} bind:this={root} role="group" aria-label={label}>
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
    {onclick}
  >
    {#if slim}<span class="grip" aria-hidden="true"></span>{:else}<span aria-hidden="true">⠿</span>{/if}
  </button>
  <div class="content">{@render children?.()}</div>
  {#if buttons}<div class="moves">
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
  </div>{/if}
</div>

<style>
  .draggable {
    display: flex;
    flex-wrap: wrap;
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
    border: var(--border-width-thin) solid transparent;
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
  .slim {
    flex-wrap: nowrap;
    padding: 0 var(--space-xs);
    border: var(--border-width-thin) solid transparent;
    border-radius: 0;
    background: transparent;
  }
  .slim .handle {
    flex: 1;
    min-height: var(--space-lg);
    cursor: ns-resize;
  }
  .slim.dragging {
    box-shadow: none;
  }
  /* The slim handle's grip: a short rounded bar at its middle, darker while it is hovered or dragged. */
  .grip {
    display: block;
    width: var(--space-xl);
    height: var(--space-xs);
    margin: 0 auto;
    border-radius: var(--radius-full);
    background: var(--color-border-strong);
  }
  .handle:hover .grip,
  .dragging .grip {
    background: var(--color-accent);
  }
  .slim .content {
    flex: 0 0 auto;
  }
  .content {
    flex: 1 1 auto;
    min-width: 0;
  }
  .moves {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
  }
</style>
