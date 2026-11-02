<!-- A row of controls, named for screen readers. The arrow keys move the focus between its buttons. Built from
     Cluster. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import Cluster from "./Cluster.svelte";

  interface Props {
    label: string;
    justify?: "start" | "center" | "end" | "between";
    children: Snippet;
  }

  let { label, justify = "start", children }: Props = $props();

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const bar = event.currentTarget as HTMLElement;
    const controls = [...bar.querySelectorAll<HTMLElement>("button:not(:disabled), input, [tabindex='0']")];
    const at = controls.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const next = (at + (event.key === "ArrowRight" ? 1 : -1) + controls.length) % controls.length;
    controls[next]?.focus();
    event.preventDefault();
  }
</script>

<div class="toolbar" role="toolbar" aria-label={label} tabindex="-1" {onkeydown}>
  <Cluster gap="sm" {justify}>{@render children()}</Cluster>
</div>

<style>
  .toolbar {
    padding: var(--space-sm) 0;
  }
</style>
