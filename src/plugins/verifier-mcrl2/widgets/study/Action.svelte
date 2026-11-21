<!-- An action, as Naima's widgets draw every action: an icon in its own small disc, a word, and, when there is room, a
     line saying what it does. Primary for the move that matters most now, quiet for the rest, danger for what fails or
     stops. Disabled, it says why in words under its label (on hover only when compact, a toolbar's icon). One of the widget set the Models tab, every study's view and the main UI
     share (develop/models-tab.md §13). -->
<script lang="ts">
  import type { Component } from "svelte";

  interface Props {
    label: string;
    /** What it does, in a few words, under the label when `detail` is set, else on hover. */
    hint?: string;
    /** Why it cannot be used now, said on hover when disabled. */
    why?: string;
    icon?: Component;
    variant?: "primary" | "quiet" | "danger";
    size?: "sm" | "md";
    detail?: boolean;
    /** Only the icon, the label said on hover and to screen readers: for a toolbar. */
    compact?: boolean;
    disabled?: boolean;
    pressed?: boolean;
    onclick?: () => void;
  }
  let { label, hint, why, icon, variant = "quiet", size = "md", detail = false, compact = false, disabled = false, pressed, onclick }: Props = $props();
  const Icon = $derived(icon);
  /** A disabled action says why in words, where it has room for words. */
  const explained = $derived(disabled && !!why && !compact);
</script>

<button
  class="action {variant} {size}"
  class:detail
  class:compact
  class:explained
  aria-label={explained ? `${label}: ${why}` : label}
  {disabled}
  aria-pressed={pressed}
  title={disabled ? (why ?? hint ?? label) : (hint ?? label)}
  {onclick}
>
  {#if Icon}<span class="disc" aria-hidden="true"><Icon class="glyph" /></span>{/if}
  <span class="words" class:hidden={compact && !!Icon}>
    <span class="label">{label}</span>
    {#if explained}<span class="hint why">{why}</span>{:else if detail && hint}<span class="hint">{hint}</span>{/if}
  </span>
</button>

<style>
  .action {
    --tone: var(--color-text);
    --disc: var(--color-surface-sunken);
    --disc-ink: var(--color-text);
    display: inline-flex;
    align-items: center;
    gap: var(--space-sm);
    min-block-size: var(--size-control);
    padding: var(--space-xs) var(--space-md) var(--space-xs) var(--space-xs);
    font: inherit;
    font-size: var(--font-size-sm);
    line-height: var(--font-line-height-tight);
    text-align: start;
    color: var(--tone);
    background: color-mix(in srgb, var(--color-surface-sunken) 55%, transparent);
    border: var(--border-width-thin) solid color-mix(in srgb, var(--color-border-strong) 40%, transparent);
    border-radius: var(--radius-full);
    cursor: pointer;
    transition: background var(--motion-duration-fast) var(--motion-easing-standard), border-color var(--motion-duration-fast) var(--motion-easing-standard), transform var(--motion-duration-fast) var(--motion-easing-standard), box-shadow var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .action.sm {
    min-block-size: var(--size-target);
    font-size: var(--font-size-xs);
    padding: var(--space-none) var(--space-sm) var(--space-none) var(--space-xs);
  }
  .action:not(:has(.disc)) {
    padding-inline-start: var(--space-md);
  }
  .disc {
    display: inline-grid;
    place-items: center;
    inline-size: calc(var(--size-control) - 2 * var(--space-xs));
    block-size: calc(var(--size-control) - 2 * var(--space-xs));
    border-radius: var(--radius-full);
    color: var(--disc-ink);
    background: var(--disc);
    transition: background var(--motion-duration-fast) var(--motion-easing-standard), color var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .disc :global(.glyph) {
    inline-size: 58%;
    block-size: 58%;
    stroke-width: 1.75;
  }
  .sm .disc {
    inline-size: calc(var(--size-target) - var(--space-xs));
    block-size: calc(var(--size-target) - var(--space-xs));
  }
  .compact {
    padding: var(--space-none);
    border-color: transparent;
    background: none;
  }
  .hidden {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .words {
    display: inline-flex;
    flex-direction: column;
    min-inline-size: 0;
  }
  .label {
    white-space: nowrap;
  }
  .hint {
    font-size: var(--font-size-2xs);
    color: var(--color-text-muted);
    white-space: nowrap;
  }
  /* Hover: a quiet tint and the disc lit; no ring, so the edge stays one clean hairline. */
  .action:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-accent) 10%, var(--color-surface-raised));
    border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
  }
  .action:hover:not(:disabled) .disc {
    --disc: var(--color-accent);
    --disc-ink: var(--color-on-accent);
  }
  .action:active:not(:disabled) {
    transform: scale(0.97);
  }
  .action:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
    outline-offset: var(--border-width-focus);
  }
  .action[aria-pressed="true"] {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .action[aria-pressed="true"] .disc {
    --disc: var(--color-accent);
    --disc-ink: var(--color-on-accent);
  }
  /* The move that matters now: the accent, its disc darker, so it reads first. */
  .primary {
    --tone: var(--color-on-accent);
    --disc: color-mix(in srgb, var(--color-on-accent) 22%, transparent);
    --disc-ink: var(--color-on-accent);
    background: linear-gradient(180deg, color-mix(in srgb, var(--color-accent) 88%, var(--color-surface-raised)), var(--color-accent));
    border-color: var(--color-accent);
  }
  .primary .hint {
    color: color-mix(in srgb, var(--color-on-accent) 75%, transparent);
  }
  .primary:hover:not(:disabled) .disc {
    --disc: color-mix(in srgb, var(--color-on-accent) 32%, transparent);
    --disc-ink: var(--color-on-accent);
  }
  .danger {
    --tone: var(--color-danger);
    --disc-ink: var(--color-danger);
  }
  .action:disabled {
    cursor: default;
    opacity: 0.38;
    filter: saturate(0.4);
  }
  /* Disabled with its reason in words: the control is dimmed, the reason stays readable. */
  .action.explained:disabled {
    opacity: 1;
    filter: none;
  }
  .action.explained:disabled .disc,
  .action.explained:disabled .label {
    opacity: 0.45;
  }
  .why {
    white-space: normal;
    color: var(--color-text-muted);
  }
  .primary.explained:disabled {
    --tone: var(--color-text);
    background: color-mix(in srgb, var(--color-surface-sunken) 55%, transparent);
    border-color: color-mix(in srgb, var(--color-border-strong) 40%, transparent);
  }
  @media (prefers-reduced-motion: reduce) {
    .action,
    .disc {
      transition: none;
    }
  }
</style>
