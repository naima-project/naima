<!-- Layout: children one under the other, separated by a spacing token. -->
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    gap?: "none" | "xs" | "sm" | "md" | "lg" | "xl";
    align?: "stretch" | "start" | "center" | "end";
    children: Snippet;
  }

  let { gap = "md", align = "stretch", children }: Props = $props();
</script>

<div class="stack gap-{gap} align-{align}">{@render children()}</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
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
  .align-stretch {
    align-items: stretch;
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
</style>
