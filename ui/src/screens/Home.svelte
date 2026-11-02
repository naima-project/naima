<!-- The home screen, for now: the summary the server gives at /data/summary, each section under its name,
     plainly. The screen of the design comes in a later step. It reads the summary machine's view. -->
<script lang="ts">
  import Button from "../lib/ui/components/Button.svelte";
  import Text from "../lib/ui/components/Text.svelte";
  import { useStore } from "../lib/ui/store/store.svelte.ts";
  import type { AppStore } from "../app.svelte.ts";
  import Plain from "./Plain.svelte";

  const { summary } = useStore<AppStore>();
</script>

<section aria-labelledby="screen-h" aria-busy={summary.view.phase === "LOADING"}>
  <Text as="h2" size="xl" strong id="screen-h">Home</Text>
  {#if summary.view.phase === "LOADING"}
    <Text tone="muted">Reading the summary…</Text>
  {:else if summary.view.phase === "FAILED"}
    <Text tone="danger" live="assertive">The summary could not be read: {summary.view.error}</Text>
    <Button onclick={() => summary.reload()}>Try again</Button>
  {:else if summary.view.sections.length === 0}
    <Text tone="muted">No plugin contributes a summary section.</Text>
  {:else}
    {#each summary.view.sections as s (s.name)}
      <section class="card" aria-label={s.name}>
        <Text as="h3" size="lg" strong>{s.name}</Text>
        <Plain value={s.data} />
      </section>
    {/each}
  {/if}
</section>

<style>
  .card {
    margin-top: var(--space-lg);
    padding: var(--space-md) var(--space-lg);
    background: var(--color-surface-raised);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-raised);
  }
</style>
