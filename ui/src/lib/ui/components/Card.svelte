<!-- A raised surface that groups content, with an optional title. Built from Stack and Text. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import Stack from "./Stack.svelte";
  import Text from "./Text.svelte";

  interface Props {
    title?: string;
    children: Snippet;
  }

  let { title, children }: Props = $props();
</script>

<section class="card">
  <Stack gap="md">
    {#if title}<Text as="h2" size="lg" strong>{title}</Text>{/if}
    {@render children()}
  </Stack>
</section>

<style>
  .card {
    padding: var(--space-xl);
    border: var(--border-width-thin) solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    box-shadow: var(--shadow-raised);
  }
</style>
