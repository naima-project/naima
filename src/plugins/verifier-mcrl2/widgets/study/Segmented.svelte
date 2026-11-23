<!-- A choice of one among a few, set as words in a row: the chosen one inked, with a hairline under it, the others
     quiet; with `current`, the option that says how things stand now carries a small dot, so a person sees both where
     things are and what each choice would do. One of the widget set. -->
<script lang="ts">
  import type { Component } from "svelte";

  interface Option {
    value: string;
    label: string;
    hint?: string;
    icon?: Component;
    disabled?: boolean;
  }
  interface Props {
    label: string;
    options: readonly Option[];
    /** The option lit as chosen; none for a row of actions that each happen once. */
    value?: string | null;
    /** The option that says how things stand now, marked with a dot. */
    current?: string | null;
    onchange: (value: string) => void;
  }
  let { label, options, value = null, current = null, onchange }: Props = $props();
</script>

<div class="seg" role="group" aria-label={label}>
  {#each options as o (o.value)}
    {@const I = o.icon}
    <button
      class="opt"
      class:on={value === o.value}
      aria-pressed={value === null ? undefined : value === o.value}
      disabled={o.disabled}
      title={o.hint ?? o.label}
      onclick={() => onchange(o.value)}
    >
      {#if I}<I class="glyph" />{/if}
      <span>{o.label}</span>
      {#if current === o.value}<span class="dot" aria-label="now"></span>{/if}
    </button>
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-none) var(--space-sm);
    max-inline-size: 100%;
  }
  .opt {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    min-block-size: var(--size-target);
    padding: var(--space-none) var(--space-xs);
    font: inherit;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    white-space: nowrap;
    text-decoration-line: underline;
    text-decoration-thickness: var(--border-width-thin);
    text-underline-offset: var(--space-xs);
    text-decoration-color: transparent;
    transition: color var(--motion-duration-fast) var(--motion-easing-standard), text-decoration-color var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .opt:hover:not(:disabled) {
    color: var(--color-text);
    text-decoration-color: var(--color-border-strong);
  }
  .opt.on {
    color: var(--color-text);
    text-decoration-color: var(--color-accent);
    text-decoration-thickness: var(--border-width-focus);
  }
  .opt:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .opt:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
  }
  .opt :global(.glyph) {
    inline-size: var(--font-size-md);
    block-size: var(--font-size-md);
    stroke-width: 1.5;
  }
  .dot {
    inline-size: var(--space-xs);
    block-size: var(--space-xs);
    border-radius: var(--radius-full);
    background: var(--color-accent);
  }
  @media (pointer: coarse) {
    .opt {
      min-block-size: var(--size-control);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .opt {
      transition: none;
    }
  }
</style>
