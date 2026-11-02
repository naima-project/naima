<!-- The theme switch: a segmented control of three choices (follow the system, light, dark), on native radio
     buttons, so Tab reaches the group and the arrow keys move between them. It is generic: the caller passes
     the current choice, usually read from the store's theme machine, and hears `onchange`. -->
<script lang="ts">
  type Choice = "system" | "light" | "dark";

  interface Props {
    value: Choice;
    onchange: (choice: Choice) => void;
    label?: string;
    labels?: Record<Choice, string>;
  }

  let { value, onchange, label = "Theme", labels = { system: "Auto", light: "Light", dark: "Dark" } }: Props = $props();
  const id = $props.id();
  const choices: Choice[] = ["system", "light", "dark"];
</script>

<div class="switch" role="radiogroup" aria-label={label}>
  {#each choices as choice (choice)}
    <label class="option" class:chosen={value === choice}>
      <input
        class="radio"
        type="radio"
        name="{id}-theme"
        value={choice}
        checked={value === choice}
        onchange={() => onchange(choice)}
      />
      {labels[choice]}
    </label>
  {/each}
</div>

<style>
  .switch {
    display: inline-flex;
    gap: var(--space-xs);
    padding: var(--space-xs);
    border: var(--border-width-thin) solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-sunken);
  }
  .option {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--size-control);
    min-height: var(--size-control);
    padding: 0 var(--space-md);
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
    font-family: var(--font-family-body);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-regular);
    cursor: pointer;
    transition:
      background-color var(--motion-duration-fast) var(--motion-easing-standard),
      color var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .option:hover {
    color: var(--color-text);
  }
  /* The chosen option is told by its weight as well as its colours, so not by colour alone. */
  .chosen {
    background: var(--color-surface-raised);
    color: var(--color-text);
    font-weight: var(--font-weight-strong);
    box-shadow: var(--shadow-key);
  }
  .radio {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .option:has(.radio:focus-visible) {
    outline: var(--border-width-focus) solid var(--color-focus);
    outline-offset: var(--border-width-focus);
  }
</style>
