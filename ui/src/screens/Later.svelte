<!-- A screen that comes in a later step: its name, and that it is not built yet. -->
<script lang="ts">
  import Text from "../lib/ui/components/Text.svelte";

  interface Props {
    name: string;
  }

  let { name }: Props = $props();
</script>

<section aria-labelledby="screen-h">
  <Text as="h2" size="xl" strong id="screen-h">{name}</Text>
  <Text tone="muted">This screen comes in a later step.</Text>
</section>
