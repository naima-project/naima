<!-- A menu button: a Button that opens a list of choices. Whether the list is open is this component's own
     state, the kind of state the stance lets a component keep; what a choice does is the caller's, through
     `onselect`. Escape and a click outside close it; the arrow keys move between the choices. -->
<script lang="ts">
  import Button from "./Button.svelte";

  interface Choice {
    value: string;
    label: string;
    disabled?: boolean;
  }

  interface Props {
    label: string;
    choices: readonly Choice[];
    onselect: (value: string) => void;
    variant?: "primary" | "secondary" | "ghost";
    /** The edge of the button the list lines up with: "end" for a button at the end of a row. */
    align?: "start" | "end";
  }

  let { label, choices, onselect, variant = "secondary", align = "start" }: Props = $props();
  const id = $props.id();

  let open = $state(false);
  let root: HTMLElement | undefined = $state();
  let menu: HTMLElement | undefined = $state();

  const items = () => [...(menu?.querySelectorAll<HTMLElement>("[role='menuitem']:not([aria-disabled='true'])") ?? [])];

  async function toggle() {
    open = !open;
    if (open) {
      await Promise.resolve();
      items()[0]?.focus();
    }
  }

  function choose(choice: Choice) {
    if (choice.disabled) return;
    open = false;
    onselect(choice.value);
    root?.querySelector<HTMLElement>("button")?.focus();
  }

  function onkeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape") {
      open = false;
      root?.querySelector<HTMLElement>("button")?.focus();
      event.preventDefault();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next = (at + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
      list[next]?.focus();
      event.preventDefault();
    }
  }

  function onwindowclick(event: MouseEvent) {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }
</script>

<svelte:window onclick={onwindowclick} />

<div class="dropdown" bind:this={root} {onkeydown} role="presentation">
  <Button {variant} aria-haspopup="menu" aria-expanded={open} aria-controls="{id}-menu" onclick={toggle}>
    {label}
    <span class="caret" aria-hidden="true">▾</span>
  </Button>
  {#if open}
    <ul class="menu" class:end={align === "end"} id="{id}-menu" role="menu" bind:this={menu}>
      {#each choices as choice (choice.value)}
        <li
          role="menuitem"
          tabindex="-1"
          aria-disabled={choice.disabled || undefined}
          onclick={() => choose(choice)}
          onkeydown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), choose(choice))}
        >
          {choice.label}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .dropdown {
    position: relative;
    display: inline-block;
  }
  .caret {
    font-size: var(--font-size-sm);
  }
  .menu {
    position: absolute;
    z-index: 1;
    inset-inline-start: 0;
    margin: var(--space-xs) 0 0;
    padding: var(--space-xs);
    min-width: var(--size-dropdown-width);
    list-style: none;
    border: var(--border-width-thin) solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    box-shadow: var(--shadow-overlay);
  }
  .end {
    inset-inline-start: auto;
    inset-inline-end: 0;
  }
  [role="menuitem"] {
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    font-size: var(--font-size-md);
    cursor: pointer;
  }
  [role="menuitem"]:hover {
    background: var(--color-surface-sunken);
  }
  [role="menuitem"]:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
    outline-offset: calc(-1 * var(--border-width-focus));
    background: var(--color-surface-sunken);
  }
  [aria-disabled="true"] {
    color: var(--color-text-muted);
    cursor: not-allowed;
  }
</style>
