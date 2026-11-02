<!-- A checkbox with its label; the whole label is the click target. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLInputAttributes } from "svelte/elements";

  interface Props extends Omit<HTMLInputAttributes, "type" | "checked"> {
    checked?: boolean;
    children: Snippet;
  }

  let { checked = $bindable(false), children, ...rest }: Props = $props();
</script>

<label class="checkbox">
  <input type="checkbox" bind:checked {...rest} />
  <span>{@render children()}</span>
</label>

<style>
  .checkbox {
    display: inline-flex;
    align-items: center;
    gap: var(--space-sm);
    min-height: var(--size-control);
    color: var(--color-text);
    font-size: var(--font-size-md);
    cursor: pointer;
  }
  input {
    width: var(--size-icon);
    height: var(--size-icon);
    margin: 0;
    accent-color: var(--color-accent);
  }
  input:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
    outline-offset: var(--border-width-focus);
  }
</style>
