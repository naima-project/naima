<!-- The shell around every screen: the rail at the top, then the moment and the screens' navigation, then the
     current screen. It reads the shell machine's view and calls its transitions; it keeps no state of its own
     (main.ts mounts it with the store in its context). -->
<script lang="ts">
  import Text from "./lib/ui/components/Text.svelte";
  import { useStore } from "./lib/ui/store/store.svelte.ts";
  import type { AppStore } from "./app.svelte.ts";
  import type { Screen } from "./logic/generated/shell/shell.ts";
  import Rail from "./Rail.svelte";
  import Home from "./screens/Home.svelte";
  import Later from "./screens/Later.svelte";

  const { shell } = useStore<AppStore>();

  // The screens, in the order of the navigation, with their names: text, not logic.
  const screens: readonly { id: Screen; name: string }[] = [
    { id: "HOME", name: "Home" },
    { id: "METRICS", name: "Metrics" },
    { id: "DIARY", name: "Diary" },
    { id: "BUGS", name: "Bugs" },
    { id: "FEATURES", name: "Features" },
    { id: "FAILED_TESTS", name: "Failed tests" },
  ];
  const current = $derived(screens.find((s) => s.id === shell.view.screen) ?? screens[0]!);
</script>

<svelte:head><title>Naima — {current.name}</title></svelte:head>

<Rail />
<header class="wrap">
  <Text as="h1" size="lg" strong>Naima</Text>
  <nav aria-label="Screens">
    <ul>
      {#each screens as s (s.id)}
        <li>
          <a
            href={`#${s.id.toLowerCase()}`}
            aria-current={s.id === shell.view.screen ? "page" : undefined}
            onclick={(e) => {
              e.preventDefault();
              shell.go(s.id);
            }}>{s.name}</a
          >
        </li>
      {/each}
    </ul>
  </nav>
</header>
<main class="wrap" id="main">
  {#if shell.view.screen === "HOME"}
    <Home />
  {:else}
    <Later name={current.name} />
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-family-body);
    font-size: var(--font-size-md);
    line-height: var(--font-line-height-normal);
  }
  .wrap {
    max-width: calc(var(--size-panel-width) * 2);
    margin: 0 auto;
    padding: 0 var(--space-lg);
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm) var(--space-lg);
    padding-top: var(--space-lg);
    padding-bottom: var(--space-md);
  }
  nav ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  nav a {
    display: inline-block;
    padding: var(--space-xs) var(--space-sm);
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
    text-decoration: none;
  }
  nav a:hover {
    color: var(--color-text);
    background: var(--color-surface-sunken);
  }
  nav a[aria-current="page"] {
    color: var(--color-text);
    background: var(--color-surface-raised);
    box-shadow: var(--shadow-raised);
    font-weight: var(--font-weight-strong);
  }
  nav a:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
    outline-offset: var(--border-width-focus);
  }
  main {
    padding-bottom: var(--space-3xl);
  }
</style>
