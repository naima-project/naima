<!-- A box that scrolls sideways, and that the mouse also pans by dragging its body, as a map or a timeline is panned.
     It is the second place in a project where pointer dragging is handled (the no-raw-drag check refuses it
     anywhere but here and in Draggable), and its dragging is only ever a shortcut: the box is always a scrolling
     box, so the wheel, the trackpad, the scrollbar and the keys move it as far as a drag can (WCAG 2.2 SC 2.5.7).

     Only the mouse pans: a touch or a pen scrolls the box natively. A press that travels less than 4 CSS px before
     it is released is a click and reaches what is under it; one that travels further pans, and the click that
     follows its release is swallowed, so a drag never picks anything. A press on an element that matches `ignore`
     (a control with a drag of its own) never pans. The box shows a grab cursor, grabbing while it pans, and selects
     no text.

     A press, by any pointer, on an element that matches `slide` (a handle inside the box, such as a timeline's
     playhead) slides it instead of panning: the pointer's x in client px is reported through `onslide` at the press,
     at every move and at the release, so the handle can follow it; the handle's owner gives the keys and clicks that
     move it as far without a drag.

     With `onpan`, the start and the end of a pan are reported too (`onpanstart`, `onpanend`), and with `onpinch` two
     pointers on the box pinch it (a pan under way ends first): the ratio of their distance before to after each move
     (above 1 the fingers came closer) and their middle's x in client px, for a box that zooms; its owner gives buttons and
     keys that zoom as far without a pinch; with `onzoomdrag` the drag's vertical travel is reported too, for a box that
     zooms as a music editor's timeline does (up closer, down further), its owner again giving buttons and keys. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";

  interface Props extends HTMLAttributes<HTMLDivElement> {
    /** What the box shows, as people call it: the box is a region named after it. */
    label: string;
    /** A selector: a press on an element inside it never pans. */
    ignore?: string;
    /** The scrolling box, for its owner to scroll or measure. */
    box?: HTMLDivElement;
    /** The box's width in CSS px, as it measures it. */
    width?: number;
    /** A selector: a press on an element inside it slides that handle instead of panning, reported through onslide. */
    slide?: string;
    /** The pointer's x in client px while a handle slides: at the press, at each move, at the release. */
    onslide?: (x: number, phase: "start" | "move" | "end") => void;
    /** For a box that does not scroll but whose owner moves a window over its content (a zoomed time axis): a drag by
     * any pointer reports the horizontal travel since the last report, in CSS px, instead of scrolling the box. The
     * owner gives the keys and the wheel that move it as far, and sets touch-action: none on what the drag starts on. */
    onpan?: (dx: number) => void;
    /** A pan starts (the pointer travelled past the slop), and ends (released, or a pinch began). */
    onpanstart?: () => void;
    onpanend?: () => void;
    /** Two pointers pinch the box: their distance before over after a move, and their middle's x in client px. */
    onpinch?: (ratio: number, x: number) => void;
    /** With `onpan`, a drag's vertical travel too, as a timeline in a music editor zooms: the travel since the last report
     * in CSS px (up negative) and the pointer's x in client px, reported before the horizontal travel of the same move. */
    onzoomdrag?: (dy: number, x: number) => void;
    children: Snippet;
  }

  let {
    label,
    ignore,
    box = $bindable(),
    width = $bindable(0),
    slide,
    onslide,
    onpan,
    onpanstart,
    onpanend,
    onpinch,
    onzoomdrag,
    children,
    class: cls = "",
    ...rest
  }: Props = $props();
  /** The pointers down on the box, while a pinch may start: their last place. */
  const down = new Map<number, { x: number; y: number }>();
  /** The pinch under way: the two pointers' last distance. */
  let pinch: number | null = null;
  const spread = () => {
    const [a, b] = [...down.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  /** The pointer sliding a handle, while it does. */
  let sliding: number | null = null;

  /** How far a press may travel, in CSS px, and still be a click. */
  const SLOP = 4;
  /** Where the press started and the box's scroll then, while a press lasts: this component's own UI state. */
  let from: { x: number; y: number; left: number; id: number } | null = null;
  let panning = $state(false);
  /** Where the pointer was at the last report to onpan. */
  let last = 0;
  let lastY = 0;
  let swallow = false;

  function onpointerdown(event: PointerEvent) {
    if (onpinch) {
      down.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (down.size === 2) {
        // A second pointer: the pan under way ends, and the two pinch.
        if (panning) onpanend?.();
        from = null;
        panning = false;
        pinch = spread();
        for (const id of down.keys()) {
          try {
            box?.setPointerCapture(id);
          } catch {
            // A pointer the browser no longer tracks: the pinch follows what reaches the box.
          }
        }
        return;
      }
    }
    if (slide && onslide && event.button === 0 && (event.target as Element).closest?.(slide)) {
      event.preventDefault();
      sliding = event.pointerId;
      try {
        box?.setPointerCapture(event.pointerId);
      } catch {
        // A pointer the browser no longer tracks: the slide still follows the moves that reach the box.
      }
      onslide(event.clientX, "start");
      return;
    }
    if ((event.pointerType !== "mouse" && !onpan) || event.button !== 0) return;
    if (ignore && (event.target as Element).closest?.(ignore)) return;
    from = { x: event.clientX, y: event.clientY, left: box?.scrollLeft ?? 0, id: event.pointerId };
    last = event.clientX;
    lastY = event.clientY;
  }

  function onpointermove(event: PointerEvent) {
    if (pinch !== null && down.has(event.pointerId)) {
      down.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const d = spread();
      if (d > 0 && pinch > 0) {
        const [a, b] = [...down.values()];
        onpinch?.(pinch / d, ((a?.x ?? 0) + (b?.x ?? 0)) / 2);
      }
      pinch = d;
      return;
    }
    if (sliding !== null) {
      if (event.pointerId === sliding) onslide?.(event.clientX, "move");
      return;
    }
    if (!from || event.pointerId !== from.id || !box) return;
    const dx = event.clientX - from.x;
    if (!panning && Math.hypot(dx, event.clientY - from.y) < SLOP) return;
    if (!panning) {
      panning = true;
      box.setPointerCapture(event.pointerId);
      if (onpan) onpanstart?.();
    }
    if (onpan) {
      if (onzoomdrag && event.clientY !== lastY) onzoomdrag(event.clientY - lastY, event.clientX);
      lastY = event.clientY;
      onpan(event.clientX - last);
      last = event.clientX;
    } else box.scrollLeft = from.left - dx;
  }

  function onpointerup(event: PointerEvent) {
    if (down.delete(event.pointerId) && pinch !== null) {
      if (down.size < 2) pinch = null;
      swallow = true;
      from = null;
      return;
    }
    if (sliding !== null) {
      if (event.pointerId !== sliding) return;
      sliding = null;
      onslide?.(event.clientX, "end");
      return;
    }
    if (!from || event.pointerId !== from.id) return;
    swallow = panning;
    if (panning && onpan) onpanend?.();
    from = null;
    panning = false;
  }

  function onclickcapture(event: MouseEvent) {
    if (!swallow) return;
    swallow = false;
    event.stopPropagation();
    event.preventDefault();
  }
</script>

<div
  {...rest}
  class="pannable {cls}"
  class:panning
  role="region"
  aria-label={label}
  bind:this={box}
  bind:clientWidth={width}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={onpointerup}
  {onclickcapture}
>
  {@render children()}
</div>

<style>
  .pannable {
    overflow-x: auto;
    min-width: 0;
    max-width: 100%;
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
  }
  .pannable.panning {
    cursor: grabbing;
  }
</style>
