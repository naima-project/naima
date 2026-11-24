<!-- An action, as the widget set draws every action: a short verb set in the page's own type, with an optional quiet
     glyph before it. No box: a faint hairline under the words says at rest that it can be pressed, inked on hover and
     focus. Primary, in the
     accent, for the one main action of a place; quiet for the rest; danger for what fails or stops. What it does and,
     disabled, why it cannot be used are said on hover and to screen readers, never inside it: an action is never a
     paragraph. Compact, only the glyph shows, for a toolbar. One of the widget set. -->
<script lang="ts">
  import type { Component } from "svelte";

  interface Props {
    label: string;
    /** What it does, in a few words, said on hover and to screen readers. */
    hint?: string;
    /** Why it cannot be used now, said on hover and to screen readers when disabled. */
    why?: string;
    icon?: Component;
    variant?: "primary" | "quiet" | "danger";
    size?: "sm" | "md";
    /** Kept for callers written before actions stopped carrying their explanation: it no longer draws anything. */
    detail?: boolean;
    /** Only the glyph, the label said on hover and to screen readers: for a toolbar. */
    compact?: boolean;
    disabled?: boolean;
    pressed?: boolean;
    onclick?: () => void;
  }
  let { label, hint, why, icon, variant = "quiet", size = "md", compact = false, disabled = false, pressed, onclick }: Props = $props();
  const Icon = $derived(icon);
  const said = $derived(disabled && why ? why : hint);
  const id = $props.id();
</script>

<button
  class="action {variant} {size}"
  class:compact={compact && !!Icon}
  aria-label={label}
  aria-describedby={said && said !== label ? `${id}-says` : undefined}
  {disabled}
  aria-pressed={pressed}
  title={said ?? label}
  {onclick}
>
  {#if Icon}<Icon class="glyph" aria-hidden="true" />{/if}
  <span class="label" class:hidden={compact && !!Icon}>{label}</span>
  {#if said && said !== label}<span class="hidden" id="{id}-says">{said}</span>{/if}
</button>

<style>
  .action {
    --ink: var(--color-text);
    --glyph: var(--color-text-muted);
    --line: var(--color-border-strong);
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    min-block-size: var(--size-control);
    max-inline-size: 100%;
    padding: var(--space-none) var(--space-xs);
    font: inherit;
    font-size: var(--font-size-sm);
    line-height: var(--font-line-height-tight);
    text-align: start;
    color: var(--ink);
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: color var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .action.sm {
    min-block-size: var(--size-target);
    font-size: var(--font-size-xs);
  }
  /* The words wrap when there is no room, never cut; their box leaves room under them for the hairline. */
  .label {
    min-inline-size: 0;
    overflow-wrap: anywhere;
    padding-block: var(--space-xs);
    text-decoration-line: underline;
    text-decoration-thickness: var(--border-width-thin);
    text-underline-offset: var(--space-xs);
    text-decoration-color: var(--line);
    transition: text-decoration-color var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .action :global(.glyph) {
    flex: none;
    inline-size: var(--font-size-md);
    block-size: var(--font-size-md);
    stroke-width: 1.5;
    color: var(--glyph);
    transition: color var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .compact {
    justify-content: center;
    min-inline-size: var(--size-target);
    padding: var(--space-none);
  }
  .compact.md {
    min-inline-size: var(--size-control);
  }
  .hidden {
    position: absolute;
    inline-size: var(--border-width-thin);
    block-size: var(--border-width-thin);
    overflow: hidden;
    clip-path: inset(50%);
  }
  /* Hover and focus: the hairline under the words, the glyph inked. Nothing else moves. */
  .action:hover:not(:disabled),
  .action:focus-visible {
    --line: currentColor;
    --glyph: var(--ink);
  }
  .compact:hover:not(:disabled) {
    --glyph: var(--color-accent);
  }
  .action:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
    outline-offset: var(--border-width-thin);
  }
  .action[aria-pressed="true"] {
    --ink: var(--color-accent);
    --glyph: var(--color-accent);
    --line: var(--color-accent);
  }
  /* The one main action of a place: the accent, a faint hairline at rest so it reads first. */
  .primary {
    --ink: var(--color-accent);
    --glyph: var(--color-accent);
    --line: var(--color-accent-line);
  }
  .danger {
    --ink: var(--color-danger);
    --glyph: var(--color-danger);
  }
  .action:disabled {
    --ink: var(--color-text-muted);
    --glyph: var(--color-text-muted);
    --line: transparent;
    cursor: default;
    opacity: 0.5;
  }
  /* A finger needs a whole control. */
  @media (pointer: coarse) {
    .action.sm {
      min-block-size: var(--size-control);
    }
    .compact {
      min-inline-size: var(--size-control);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .action,
    .label,
    .action :global(.glyph) {
      transition: none;
    }
  }
</style>
