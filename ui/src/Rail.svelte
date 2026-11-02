<!-- The rail: the strip stuck to the top, closed, or open as a popover over the screen; and the moment, Live or
     a commit of the past with the way back to Live. The metro map that fills the rail is a later step: open,
     it says so. It reads the shell machine's view and calls its transitions. -->
<script lang="ts">
  import Button from "./lib/ui/components/Button.svelte";
  import Text from "./lib/ui/components/Text.svelte";
  import { useStore } from "./lib/ui/store/store.svelte.ts";
  import type { AppStore } from "./app.svelte.ts";

  const { shell } = useStore<AppStore>();
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") shell.closeRail();
  }}
/>

<section id="rail" aria-labelledby="rail-h">
  <div class="bar">
    <Text as="h2" size="md" strong id="rail-h">Rail</Text>
    <span class="line" aria-hidden="true"></span>
    <span class="moment" aria-live="polite">
      {#if shell.view.moment === "LIVE"}
        <span class="live"><span class="dot" aria-hidden="true"></span>Live</span>
      {:else}
        <Text as="span" size="sm" tone="muted">Commit {shell.view.at}</Text>
        <Button variant="primary" onclick={() => shell.live()}>Back to live</Button>
      {/if}
    </span>
    <Button
      aria-expanded={shell.view.rail === "OPEN"}
      aria-controls="rail-body"
      onclick={() => (shell.view.rail === "OPEN" ? shell.closeRail() : shell.openRail())}
    >
      {shell.view.rail === "OPEN" ? "Close" : "Open"}
    </Button>
  </div>
  <div id="rail-body" class="body" hidden={shell.view.rail !== "OPEN"}>
    <Text tone="muted">The metro map of the lines and the commits comes here, in a later step.</Text>
  </div>
</section>

<style>
  #rail {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--color-surface-raised);
    border-bottom: var(--border-width-thin) solid var(--color-border);
    padding: var(--space-xs) var(--space-lg);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    min-height: var(--space-xl);
  }
  .line {
    flex: 1;
    border-top: var(--border-width-focus) dashed var(--color-border-strong);
  }
  .moment {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }
  .live {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    font-weight: var(--font-weight-strong);
    color: var(--color-success);
  }
  .dot {
    width: var(--space-sm);
    height: var(--space-sm);
    border-radius: var(--radius-full);
    background: var(--color-success);
  }
  .body {
    position: absolute;
    left: 0;
    right: 0;
    top: 100%;
    background: var(--color-surface-raised);
    border-bottom: var(--border-width-thin) solid var(--color-border);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-md) var(--space-lg);
  }
  .body[hidden] {
    display: none;
  }
</style>
