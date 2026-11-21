<!-- A choice of one among a few, drawn as one capsule whose lit segment is the choice; with `current`, the segment that
     says how things stand now is marked too, so a person sees both where things are and what each choice would do.
     One of the widget set the Models tab, every study's view and the main UI share (develop/models-tab.md §13). -->
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
    max-inline-size: 100%;
    padding: var(--space-xs);
    gap: var(--space-xs);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-surface-sunken) 70%, transparent);
    border: var(--border-width-thin) solid color-mix(in srgb, var(--color-border-strong) 50%, transparent);
  }
  .opt {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    min-block-size: calc(var(--size-control) - 2 * var(--space-xs));
    padding: var(--space-none) var(--space-md);
    font: inherit;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    background: none;
    border: none;
    border-radius: var(--radius-full);
    cursor: pointer;
    white-space: nowrap;
    transition: background var(--motion-duration-fast) var(--motion-easing-standard), color var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .opt:hover:not(:disabled) {
    color: var(--color-text);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  .opt.on {
    color: var(--color-on-accent);
    background: var(--color-accent);
  }
  .opt:disabled {
    opacity: 0.38;
    cursor: default;
  }
  .opt:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
  }
  .opt :global(.glyph) {
    inline-size: var(--font-size-md);
    block-size: var(--font-size-md);
  }
  .dot {
    inline-size: var(--space-xs);
    block-size: var(--space-xs);
    border-radius: var(--radius-full);
    background: var(--color-accent);
    box-shadow: 0 0 0 var(--border-width-thin) var(--color-surface-raised);
  }
  .on .dot {
    background: var(--color-on-accent);
  }
</style>
