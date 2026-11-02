<!-- A slot for an icon (an inline SVG, or a glyph), sized by the icon token and coloured by the text around it.
     Without a label it is decoration and hidden from screen readers; with one it is an image with that name. -->
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    label?: string;
    children: Snippet;
  }

  let { label, children }: Props = $props();
</script>

{#if label}
  <span class="icon" role="img" aria-label={label}>{@render children()}</span>
{:else}
  <span class="icon" aria-hidden="true">{@render children()}</span>
{/if}

<style>
  .icon {
    display: inline-flex;
    width: var(--size-icon);
    height: var(--size-icon);
    color: currentColor;
    flex: none;
  }
  .icon :global(svg) {
    width: 100%;
    height: 100%;
    fill: currentColor;
  }
</style>
