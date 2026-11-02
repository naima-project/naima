<!-- A one-line text input. Its value is bindable; `invalid` sets aria-invalid and the danger border. -->
<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";

  interface Props extends Omit<HTMLInputAttributes, "value"> {
    value?: string;
    invalid?: boolean;
  }

  let { value = $bindable(""), invalid = false, type = "text", ...rest }: Props = $props();
</script>

<input class="input" class:invalid {type} bind:value aria-invalid={invalid || undefined} {...rest} />

<style>
  .input {
    box-sizing: border-box;
    width: 100%;
    min-height: var(--size-control);
    padding: 0 var(--space-md);
    border: var(--border-width-thin) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-md);
  }
  .input:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
    outline-offset: 0;
  }
  .invalid {
    border-color: var(--color-danger);
  }
</style>
