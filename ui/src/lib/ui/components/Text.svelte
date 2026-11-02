<!-- Text: a paragraph, a span, a heading or a label, in one of the token sizes and tones. -->
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    as?: "p" | "span" | "h1" | "h2" | "h3" | "label" | "div";
    size?: "sm" | "md" | "lg" | "xl";
    tone?: "default" | "muted" | "danger" | "success";
    strong?: boolean;
    mono?: boolean;
    /** For a label: the id of the control it names. */
    for?: string;
    id?: string;
    /** For a message that changes: "polite" makes screen readers announce it. */
    live?: "polite" | "assertive";
    children: Snippet;
  }

  let { as = "p", size = "md", tone = "default", strong = false, mono = false, for: htmlFor, id, live, children }: Props =
    $props();
</script>

<svelte:element
  this={as}
  class="text {size} {tone}"
  class:strong
  class:mono
  for={as === "label" ? htmlFor : undefined}
  {id}
  aria-live={live}
>
  {@render children()}
</svelte:element>

<style>
  .text {
    margin: 0;
    font-family: var(--font-family-body);
    line-height: var(--font-line-height-normal);
    color: var(--color-text);
  }
  .sm {
    font-size: var(--font-size-sm);
  }
  .md {
    font-size: var(--font-size-md);
  }
  .lg {
    font-size: var(--font-size-lg);
    line-height: var(--font-line-height-tight);
  }
  .xl {
    font-size: var(--font-size-xl);
    line-height: var(--font-line-height-tight);
  }
  .muted {
    color: var(--color-text-muted);
  }
  .danger {
    color: var(--color-danger);
  }
  .success {
    color: var(--color-success);
  }
  .strong {
    font-weight: var(--font-weight-strong);
  }
  .mono {
    font-family: var(--font-family-mono);
  }
</style>
