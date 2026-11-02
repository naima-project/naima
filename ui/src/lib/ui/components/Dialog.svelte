<!-- A modal dialog on the native <dialog> element, which traps the focus and closes on Escape. Whether it is
     open is not its own state: the caller passes `open` (from the store) and hears `onclose`. Built from Card,
     Stack, Text and Cluster. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import Cluster from "./Cluster.svelte";
  import Stack from "./Stack.svelte";
  import Text from "./Text.svelte";

  interface Props {
    open: boolean;
    title: string;
    onclose: () => void;
    children: Snippet;
    actions?: Snippet;
  }

  let { open, title, onclose, children, actions }: Props = $props();
  const id = $props.id();
  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  class="dialog"
  bind:this={dialog}
  aria-labelledby="{id}-title"
  onclose={() => open && onclose()}
>
  <Stack gap="lg">
    <Text as="h2" size="lg" strong id="{id}-title">{title}</Text>
    {@render children()}
    {#if actions}<Cluster gap="sm" justify="end">{@render actions()}</Cluster>{/if}
  </Stack>
</dialog>

<style>
  .dialog {
    width: var(--size-dialog-width);
    max-width: 100%;
    padding: var(--space-xl);
    border: var(--border-width-thin) solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    color: var(--color-text);
    box-shadow: var(--shadow-overlay);
  }
  .dialog::backdrop {
    background: var(--color-overlay);
  }
</style>
