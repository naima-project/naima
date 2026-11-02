<!-- Layout: children side by side, wrapping when the line is full, separated by a spacing token. -->
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    gap?: "none" | "xs" | "sm" | "md" | "lg" | "xl";
    justify?: "start" | "center" | "end" | "between";
    align?: "start" | "center" | "end" | "baseline";
    children: Snippet;
  }

  let { gap = "sm", justify = "start", align = "center", children }: Props = $props();
</script>

<div class="cluster gap-{gap} justify-{justify} align-{align}">{@render children()}</div>

<style>
  .cluster {
    display: flex;
    flex-wrap: wrap;
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
  .justify-start {
    justify-content: flex-start;
  }
  .justify-center {
    justify-content: center;
  }
  .justify-end {
    justify-content: flex-end;
  }
  .justify-between {
    justify-content: space-between;
  }
  .align-start {
    align-items: flex-start;
  }
  .align-center {
    align-items: center;
  }
  .align-end {
    align-items: flex-end;
  }
  .align-baseline {
    align-items: baseline;
  }
</style>
