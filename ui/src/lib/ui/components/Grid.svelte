<!-- Layout: children on a grid of equal columns, separated by a spacing token. A child spans more
     columns with style="grid-column: span 2". -->
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    columns?: number;
    gap?: "none" | "xs" | "sm" | "md" | "lg" | "xl";
    children: Snippet;
  }

  let { columns = 4, gap = "md", children }: Props = $props();
</script>

<div class="grid gap-{gap}" style:grid-template-columns="repeat({columns}, minmax(0, 1fr))">{@render children()}</div>

<style>
  .grid {
    display: grid;
  }
  .gap-none {
    gap: var(--space-none);
  }
  .gap-xs {
    gap: var(--space-xs);
  }
  .gap-sm {
    gap: var(--space-sm);
  }
  .gap-md {
    gap: var(--space-md);
  }
  .gap-lg {
    gap: var(--space-lg);
  }
  .gap-xl {
    gap: var(--space-xl);
  }
</style>
