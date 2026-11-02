<!-- A button. Variants change only its colours; every size and colour is a token. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  interface Props extends HTMLButtonAttributes {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    children: Snippet;
  }

  let { variant = "secondary", type = "button", children, ...rest }: Props = $props();
</script>

<button class="button {variant}" {type} {...rest}>{@render children()}</button>

<style>
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-sm);
    min-height: var(--size-control);
    padding: 0 var(--space-lg);
    border: var(--border-width-thin) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-strong);
    cursor: pointer;
    transition: background-color var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .button:hover:not(:disabled) {
    background: var(--color-surface-sunken);
  }
  .button:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
    outline-offset: var(--border-width-focus);
  }
  .button:disabled {
    color: var(--color-text-muted);
    cursor: not-allowed;
  }
  .primary {
    border-color: var(--color-accent);
    background: var(--color-accent);
    color: var(--color-on-accent);
  }
  .primary:hover:not(:disabled) {
    background: var(--color-accent-hover);
  }
  .ghost {
    border-color: transparent;
    background: transparent;
  }
  .danger {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }
</style>
