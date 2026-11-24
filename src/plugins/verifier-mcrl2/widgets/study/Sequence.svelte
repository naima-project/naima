<!-- A UML sequence diagram (named.ts, uml-sequence), in its notation unaltered: a lifeline per participant, a head
     box and a dashed line down; each message an arrow from sender to receiver with its label, in order from top to
     bottom. The latest message is the accent; older ones stay, and the card scrolls to the newest. In a card narrower
     than the drawing, the whole drawing is scaled down to the card's width, so that no lifeline is cut off. -->
<script module lang="ts">
  export interface Message {
    from: string;
    to: string;
    label: string;
    title?: string;
  }
</script>

<script lang="ts">
  interface Props {
    label: string;
    lifelines: readonly string[];
    messages: readonly Message[];
    /** How many of the last messages are drawn. */
    last?: number;
  }
  let { label, lifelines, messages, last = 40 }: Props = $props();

  /** Wide enough for the messages between neighbours, whatever the number of lifelines; drawn at its own size. */
  const W = $derived(Math.max(520, 180 + (lifelines.length - 1) * 220));
  const STEP = 30;
  const shown = $derived(messages.slice(-last));
  const lx = (who: string) => {
    const i = Math.max(0, lifelines.indexOf(who));
    return lifelines.length === 1 ? W / 2 : 90 + (i * (W - 180)) / (lifelines.length - 1);
  };
  const H = $derived(16 + shown.length * STEP + 30);
  let box: HTMLDivElement | undefined = $state();
  $effect(() => {
    void shown.length;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  });
</script>

<div class="sequence">
  <!-- The heads stay in view; the messages scroll under them. -->
  <svg class="heads" style:max-inline-size="calc({W}px * var(--text-scale, 1))" viewBox="0 0 {W} 34" aria-hidden="true">
    {#each lifelines as l (l)}
      <rect class="headbox" x={lx(l) - 66} y="4" width="132" height="26" rx="2" />
      <text class="who" x={lx(l)} y="21" text-anchor="middle">{l}</text>
    {/each}
  </svg>
  <div class="body" bind:this={box}>
    <svg style:max-inline-size="calc({W}px * var(--text-scale, 1))" viewBox="0 0 {W} {H}" role="img" aria-label={label}>
      {#each lifelines as l (l)}
        <line class="life" x1={lx(l)} x2={lx(l)} y1="0" y2={H - 8} />
      {/each}
      {#each shown as m, i (i)}
        {@const y = 16 + i * STEP + 12}
        {@const x1 = lx(m.from)}
        {@const x2 = lx(m.to)}
        {@const dir = Math.sign(x2 - x1) || 1}
        <g class="msg" class:latest={i === shown.length - 1}>
          <line x1={x1} x2={x2 - dir * 1} y1={y} y2={y} />
          <path class="head" d="M {x2} {y} L {x2 - dir * 9} {y - 4.5} L {x2 - dir * 9} {y + 4.5} Z" />
          <text x={(x1 + x2) / 2} y={y - 6} text-anchor="middle">{m.label}</text>
          {#if m.title}<title>{m.title}</title>{/if}
        </g>
      {/each}
    </svg>
  </div>
</div>

<style>
  .sequence {
    display: flex;
    flex-direction: column;
    align-items: center;
    block-size: 100%;
    min-block-size: 0;
  }
  .heads {
    flex: none;
  }
  .body {
    flex: 1;
    inline-size: 100%;
    min-block-size: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  svg {
    display: block;
    inline-size: 100%;
    block-size: auto;
    flex: none;
  }
  text {
    font-family: var(--font-family-body);
  }
  .headbox {
    fill: var(--color-surface-raised);
    stroke: var(--color-text);
    stroke-width: 1.2;
  }
  .who {
    font-size: calc(var(--font-size-xs) / var(--text-scale, 1));
    fill: var(--color-text);
  }
  .life {
    stroke: var(--color-text-muted);
    stroke-width: 1;
    stroke-dasharray: 5 4;
  }
  .msg line {
    stroke: var(--color-text-muted);
    stroke-width: 1.2;
  }
  .msg .head {
    fill: var(--color-text-muted);
  }
  .msg text {
    font-size: calc(var(--font-size-2xs) / var(--text-scale, 1));
    fill: var(--color-text-muted);
  }
  .msg.latest line {
    stroke: var(--color-accent);
    stroke-width: 1.8;
  }
  .msg.latest .head {
    fill: var(--color-accent);
  }
  .msg.latest text {
    fill: var(--color-accent);
  }
</style>
