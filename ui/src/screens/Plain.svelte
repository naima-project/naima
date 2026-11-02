<!-- Any JSON value, plainly: a list for an array, a list of names and values for an object, the text of the
     rest. What a summary section's data holds differs by plugin; this shows all of them alike. -->
<script lang="ts">
  import Self from "./Plain.svelte";

  interface Props {
    value: unknown;
  }

  let { value }: Props = $props();
</script>

{#if Array.isArray(value)}
  {#if value.length === 0}
    <span class="none">none</span>
  {:else}
    <ul>
      {#each value as v, i (i)}
        <li><Self value={v} /></li>
      {/each}
    </ul>
  {/if}
{:else if value !== null && typeof value === "object"}
  <dl>
    {#each Object.entries(value) as [k, v] (k)}
      <dt>{k}</dt>
      <dd><Self value={v} /></dd>
    {/each}
  </dl>
{:else if value === null || value === undefined}
  <span class="none">none</span>
{:else}
  <span>{String(value)}</span>
{/if}

<style>
  ul {
    margin: 0;
    padding-left: var(--space-lg);
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-xs) var(--space-md);
    margin: 0;
  }
  dt {
    color: var(--color-text-muted);
  }
  dd {
    margin: 0;
  }
  .none {
    color: var(--color-text-muted);
  }
</style>
