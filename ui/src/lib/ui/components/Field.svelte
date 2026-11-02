<!-- A labelled text field: Text as the label, Input, and Text as the message under it, tied together by ids
     so that screen readers read the label and the message with the input. -->
<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import Input from "./Input.svelte";
  import Stack from "./Stack.svelte";
  import Text from "./Text.svelte";

  interface Props extends Omit<HTMLInputAttributes, "value"> {
    label: string;
    value?: string;
    /** A hint, or the reason the value is not valid. */
    message?: string;
    invalid?: boolean;
  }

  let { label, value = $bindable(""), message, invalid = false, ...rest }: Props = $props();
  const id = $props.id();
</script>

<Stack gap="xs">
  <Text as="label" for="{id}-input" size="sm" strong>{label}</Text>
  <Input id="{id}-input" bind:value {invalid} aria-describedby={message ? `${id}-message` : undefined} {...rest} />
  {#if message}
    <Text id="{id}-message" size="sm" tone={invalid ? "danger" : "muted"} live="polite">{message}</Text>
  {/if}
</Stack>
