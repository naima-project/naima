<!-- A menu of actions used now and then: a quiet trigger (a word, or the three dots of "more" when it has no word) that
     opens a short list. Whether the list is open is this component's own state; what an entry does is the caller's.
     The trigger has a name for screen readers; Enter, Space or the down arrow open the list on its first entry, the
     arrows move, Escape and a click outside close it and give the focus back. An entry may be a choice (checked), and a
     line between entries groups them. One of the widget set. -->
<script lang="ts" module>
  import type { Component } from "svelte";

  export interface Entry {
    label: string;
    onselect?: () => void;
    disabled?: boolean;
    /** Why it cannot be used now, said beside it when disabled. */
    why?: string;
    /** A choice among entries: whether it is the one chosen. */
    checked?: boolean;
    icon?: Component;
    /** A line before this entry, to group the ones after it. */
    rule?: boolean;
    /** A quiet heading before this entry, naming the group it starts. */
    group?: string;
  }
</script>

<script lang="ts">
  import More from "@lucide/svelte/icons/ellipsis";
  import { tick } from "svelte";

  interface Props {
    /** The trigger's name for screen readers, and on hover: "More for the path". */
    label: string;
    entries: readonly Entry[];
    /** A word on the trigger; without one, the trigger is the three dots of "more". */
    text?: string;
    /** The edge of the trigger the list lines up with. */
    align?: "start" | "end";
    /** What the trigger says on hover, when more than its name helps. */
    hint?: string;
  }
  let { label, entries, text, align = "end", hint }: Props = $props();
  const id = $props.id();

  let open = $state(false);
  let root: HTMLElement | undefined = $state();
  let list: HTMLElement | undefined = $state();
  let trigger: HTMLButtonElement | undefined = $state();

  const items = () => [...(list?.querySelectorAll<HTMLElement>("[role^='menuitem']:not([aria-disabled='true'])") ?? [])];
  const show = async (at: "first" | "last" = "first") => {
    open = true;
    await tick();
    const xs = items();
    (at === "first" ? xs[0] : xs.at(-1))?.focus();
  };
  const hide = (refocus = true) => {
    open = false;
    if (refocus) trigger?.focus();
  };
  const choose = (e: Entry) => {
    if (e.disabled) return;
    hide();
    e.onselect?.();
  };
  const onTriggerKey = (ev: KeyboardEvent) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      void show(ev.key === "ArrowDown" ? "first" : "last");
    }
  };
  const onListKey = (ev: KeyboardEvent) => {
    const xs = items();
    const at = xs.indexOf(document.activeElement as HTMLElement);
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      xs[(at + (ev.key === "ArrowDown" ? 1 : -1) + xs.length) % xs.length]?.focus();
    } else if (ev.key === "Home" || ev.key === "End") {
      ev.preventDefault();
      (ev.key === "Home" ? xs[0] : xs.at(-1))?.focus();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      hide();
    } else if (ev.key === "Tab") hide(false);
  };
  const onWindowPointer = (ev: PointerEvent) => {
    if (open && root && !root.contains(ev.target as Node)) hide(false);
  };
</script>

<svelte:window onpointerdown={onWindowPointer} />

<span class="menu" bind:this={root}>
  <button
    class="trigger"
    class:dots={!text}
    bind:this={trigger}
    aria-label={label}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls="{id}-list"
    title={hint ?? label}
    onclick={() => (open ? hide() : void show())}
    onkeydown={onTriggerKey}
  >
    {#if text}<span class="word">{text}</span>{:else}<More class="glyph" aria-hidden="true" />{/if}
  </button>
  {#if open}
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <ul class="list" class:start={align === "start"} id="{id}-list" role="menu" aria-label={label} bind:this={list} onkeydown={onListKey}>
      {#each entries as e, i (i)}
        {@const I = e.icon}
        {#if e.rule && i > 0}<li class="rule" role="separator"></li>{/if}
        {#if e.group}<li class="group" role="presentation">{e.group}</li>{/if}
        <li
          role={e.checked === undefined ? "menuitem" : "menuitemradio"}
          aria-checked={e.checked}
          tabindex="-1"
          aria-disabled={e.disabled || undefined}
          title={e.disabled ? e.why : undefined}
          onclick={() => choose(e)}
          onkeydown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), choose(e))}
        >
          <span class="mark" aria-hidden="true">{#if e.checked}•{:else if I}<I class="glyph" />{/if}</span>
          <span class="words">{e.label}{#if e.disabled && e.why}<span class="why">{e.why}</span>{/if}</span>
        </li>
      {/each}
    </ul>
  {/if}
</span>

<style>
  .menu {
    position: relative;
    display: inline-flex;
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-block-size: var(--size-target);
    min-inline-size: var(--size-target);
    padding: var(--space-none) var(--space-xs);
    font: inherit;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: color var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .trigger.dots {
    padding: var(--space-none);
  }
  .word {
    text-decoration-line: underline;
    text-decoration-thickness: var(--border-width-thin);
    text-underline-offset: var(--space-xs);
    text-decoration-color: transparent;
    transition: text-decoration-color var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .trigger:hover,
  .trigger[aria-expanded="true"] {
    color: var(--color-text);
  }
  .trigger:hover .word,
  .trigger:focus-visible .word,
  .trigger[aria-expanded="true"] .word {
    text-decoration-color: currentColor;
  }
  .trigger:focus-visible,
  [role^="menuitem"]:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
    outline-offset: calc(-1 * var(--border-width-thin));
  }
  .menu :global(.glyph) {
    inline-size: var(--font-size-md);
    block-size: var(--font-size-md);
    stroke-width: 1.5;
  }
  .list {
    position: absolute;
    z-index: 20;
    inset-block-start: 100%;
    inset-inline-end: 0;
    margin: var(--space-xs) 0 0;
    padding: var(--space-xs) var(--space-none);
    min-inline-size: var(--size-dropdown-width);
    max-inline-size: min(calc(3 * var(--size-dropdown-width)), 90vw);
    list-style: none;
    background: var(--color-surface-raised);
    border: var(--border-width-thin) solid var(--color-border-soft);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
  }
  .list.start {
    inset-inline-end: auto;
    inset-inline-start: 0;
  }
  [role^="menuitem"] {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
    min-block-size: var(--size-target);
    padding: var(--space-xs) var(--space-md) var(--space-xs) var(--space-sm);
    font-size: var(--font-size-sm);
    color: var(--color-text);
    cursor: pointer;
  }
  [role^="menuitem"]:hover:not([aria-disabled="true"]),
  [role^="menuitem"]:focus-visible {
    background: var(--color-surface-sunken);
  }
  [aria-disabled="true"] {
    color: var(--color-text-muted);
    cursor: default;
  }
  .mark {
    flex: none;
    display: inline-flex;
    justify-content: center;
    inline-size: var(--font-size-md);
    color: var(--color-accent);
  }
  .mark :global(.glyph) {
    color: var(--color-text-muted);
    align-self: center;
  }
  .words {
    display: flex;
    flex-direction: column;
  }
  .why {
    font-size: var(--font-size-2xs);
    color: var(--color-text-muted);
  }
  .group {
    padding: var(--space-xs) var(--space-md) var(--space-none) var(--space-sm);
    padding-inline-start: calc(var(--space-sm) * 2 + var(--font-size-md));
    font-size: var(--font-size-2xs);
    color: var(--color-text-muted);
  }
  .rule {
    block-size: var(--border-width-thin);
    margin: var(--space-xs) var(--space-sm);
    background: var(--color-border-soft);
  }
  @media (pointer: coarse) {
    .trigger,
    [role^="menuitem"] {
      min-block-size: var(--size-control);
      min-inline-size: var(--size-control);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .trigger,
    .word {
      transition: none;
    }
  }
</style>
