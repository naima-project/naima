<!-- A keycap: a large button for a keypad (a calculator, a PIN pad). Its tone says what kind of key it is;
     `active` shows a key that stays selected (aria-pressed), and `echo` briefly shows it pressed, for a
     key pressed on the keyboard. Every colour, size and duration is a token. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  interface Props extends HTMLButtonAttributes {
    tone?: "plain" | "quiet" | "soft" | "accent";
    active?: boolean;
    echo?: boolean;
    wide?: boolean;
    children: Snippet;
  }

  let { tone = "plain", active, echo = false, wide = false, type = "button", children, ...rest }: Props = $props();
</script>

<button
  class="keycap {tone}"
  class:echo
  class:wide
  class:active
  aria-pressed={active === undefined ? undefined : active}
  {type}
  {...rest}
>
  <span class="label">{@render children()}</span>
</button>

<style>
  .keycap {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: var(--size-key);
    padding: 0;
    border: none;
    border-radius: var(--radius-lg);
    background: var(--color-key);
    color: var(--color-text);
    box-shadow: var(--shadow-key);
    font-family: var(--font-family-body);
    font-size: var(--font-size-xl);
    font-weight: var(--font-weight-regular);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color var(--motion-duration-fast) var(--motion-easing-standard),
      box-shadow var(--motion-duration-fast) var(--motion-easing-standard),
      transform var(--motion-duration-instant) var(--motion-easing-standard);
  }
  .wide {
    grid-column: span 2;
  }
  .label {
    display: inline-block;
    transition: transform var(--motion-duration-instant) var(--motion-easing-standard);
  }
  .keycap:hover {
    background: var(--color-key-hover);
  }
  .keycap:active,
  .keycap.echo {
    background: var(--color-key-pressed);
    box-shadow: none;
    transform: scale(0.97);
  }
  .keycap:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
    outline-offset: var(--border-width-focus);
  }
  .quiet {
    background: var(--color-surface-sunken);
    color: var(--color-text-muted);
    box-shadow: none;
    font-size: var(--font-size-lg);
  }
  .quiet:hover {
    background: var(--color-border);
    color: var(--color-text);
  }
  .soft {
    color: var(--color-accent);
    font-size: var(--font-size-xl);
  }
  .soft.active {
    background: var(--color-accent-soft);
    box-shadow: none;
  }
  .accent {
    background: var(--color-accent);
    color: var(--color-on-accent);
  }
  .accent:hover {
    background: var(--color-accent-hover);
  }
  .accent:active,
  .accent.echo {
    background: var(--color-accent-hover);
  }
</style>
