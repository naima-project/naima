<!-- A timeline of a path: the states taken on a line, the past fading to the left, the current state as the accent
     disc, the steps possible now on the horizon at its right. A click on a past state goes back to it; a click on a step
     ahead takes it. It zooms (the space between steps) and pans when longer than its box, and keeps the current state in
     view. Real steps carry a bar above their state. -->
<script lang="ts">
  import Pannable from "../Pannable.svelte";

  interface Props {
    label: string;
    /** The steps taken, in order: each one's short name, its full label, and whether it is real. */
    past: readonly { name: string; title: string; real?: boolean }[];
    /** Where the cursor is: after how many steps. */
    position: number;
    /** The steps possible now. */
    ahead: readonly { name: string; detail?: string; title: string; key: string }[];
    pinned?: ReadonlySet<number>;
    onpick: (k: number) => void;
    onfire: (key: string) => void;
    /** How many steps ahead are drawn; the rest are counted. */
    show?: number;
  }
  let { label, past, position, ahead, pinned = new Set(), onpick, onfire, show = 7 }: Props = $props();

  let dx = $state(112);
  const X0 = 40;
  /** The drawing's own height, the line at its middle and the steps ahead spread over it; the box centres it, and a
   * card lower than the drawing scrolls it. */
  const H = 214;
  const Y = H / 2 + 6;
  const xOf = (k: number) => X0 + k * dx;
  const xNow = $derived(xOf(position));
  const fade = (k: number) => (pinned.has(k) ? 1 : Math.max(0.22, 1 - (position - k) * 0.09));
  const drawn = $derived(ahead.slice(0, show));
  const yAhead = (i: number, n: number) => Y + (i - (n - 1) / 2) * Math.min(30, (H - 40) / Math.max(1, n));
  const W = $derived(Math.max(xOf(past.length), xNow + 1.6 * dx) + 260);
  const short = (t: string) => (t.length > 20 ? `${t.slice(0, 19)}…` : t);

  let box: HTMLDivElement | undefined = $state();
  $effect(() => {
    const x = xNow;
    if (box) box.scrollTo({ left: Math.max(0, x - box.clientWidth * 0.55), behavior: "smooth" });
  });
</script>

<div class="timeline">
  <div class="controls" role="toolbar" aria-label="{label}: zoom">
    <span class="where">step {position} of {past.length}</span>
    <span class="sep"></span>
    <button aria-label="Closer together" onclick={() => (dx = Math.max(40, dx / 1.25))}>−</button>
    <button aria-label="Further apart" onclick={() => (dx = Math.min(260, dx * 1.25))}>+</button>
  </div>
  <Pannable {label} class="pan" ignore=".state, .ahead" bind:box>
    <svg width={W} height={H} viewBox="0 0 {W} {H}" role="img" aria-label={label}>
      <line class="track" x1={xOf(0)} x2={xOf(past.length)} y1={Y} y2={Y} />
      {#each past as p, i (i)}
        <g class="past" class:after={i >= position} style:opacity={i < position ? fade(i) : 0.3}>
          <text class="label" x={(xOf(i) + xOf(i + 1)) / 2} y={i % 2 === 0 ? Y - 14 : Y + 26} text-anchor="middle">{short(p.name)}<title>{p.title}</title></text>
          {#if p.real}<rect class="real" x={xOf(i + 1) - 12} y={Y - 30} width="24" height="3" />{/if}
        </g>
      {/each}
      {#each Array.from({ length: past.length + 1 }, (_, k) => k) as k (k)}
        {#if k !== position}
          <circle
            class="state"
            class:pinned={pinned.has(k)}
            style:opacity={k < position ? fade(k) : 0.35}
            cx={xOf(k)}
            cy={Y}
            r="7"
            role="button"
            tabindex="0"
            aria-label="go to step {k}"
            onclick={() => onpick(k)}
            onkeydown={(e) => e.key === "Enter" && onpick(k)}
          />
        {/if}
      {/each}
      {#each drawn as s, i (s.key)}
        {@const y = yAhead(i, drawn.length)}
        <g class="ahead" role="button" tabindex="0" aria-label="take {s.title}" onclick={() => onfire(s.key)} onkeydown={(e) => e.key === "Enter" && onfire(s.key)}>
          <path class="branch" d="M {xNow} {Y} C {xNow + dx * 0.8} {Y}, {xNow + dx * 0.8} {y}, {xNow + dx * 1.6} {y}" />
          <circle class="maybe" cx={xNow + dx * 1.6} cy={y} r="6" />
          <text class="label ahead-label" x={xNow + dx * 1.6 + 14} y={y + 4}>{s.name}{#if s.detail}<tspan class="arg" dx="6">{s.detail}</tspan>{/if}</text>
          <title>{s.title}</title>
        </g>
      {/each}
      {#if ahead.length > show}
        <text class="more" x={xNow + dx * 1.6 + 14} y={yAhead(show, show + 1) + 4}>and {ahead.length - show} more</text>
      {/if}
      <circle class="halo" cx={xNow} cy={Y} r="17" />
      <circle class="now" cx={xNow} cy={Y} r="11" />
    </svg>
  </Pannable>
</div>

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    block-size: 100%;
    min-block-size: 0;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-family: var(--font-family-mono);
    font-size: var(--font-size-2xs);
    color: var(--color-text-muted);
  }
  .controls button {
    font: inherit;
    min-block-size: var(--size-target);
    min-inline-size: var(--size-target);
    color: var(--color-text-muted);
    background: none;
    border: none;
    border-radius: var(--radius-full);
    cursor: pointer;
  }
  .controls button:hover {
    color: var(--color-accent);
  }
  .sep {
    flex: 1;
  }
  .timeline :global(.pan) {
    flex: 1;
    min-block-size: 0;
    overflow: auto;
    display: flex;
    align-items: safe center;
  }
  svg {
    display: block;
    flex: none;
  }
  text {
    font-family: var(--font-family-body);
  }
  .track {
    stroke: var(--color-text-muted);
    stroke-width: 1.2;
  }
  .state {
    fill: var(--color-surface-raised);
    stroke: var(--color-text);
    stroke-width: 1.4;
    cursor: pointer;
  }
  .state:hover,
  .state:focus {
    stroke: var(--color-accent);
  }
  .state.pinned {
    stroke: var(--color-accent);
    stroke-width: 2.4;
  }
  .now {
    fill: var(--color-accent);
  }
  .halo {
    fill: none;
    stroke: var(--color-accent);
    stroke-width: 1;
    opacity: 0.45;
  }
  .branch {
    fill: none;
    stroke: var(--color-border-strong);
    stroke-width: 1;
    stroke-dasharray: 2 4;
  }
  .maybe {
    fill: none;
    stroke: var(--color-text-muted);
    stroke-width: 1.2;
  }
  .ahead {
    cursor: pointer;
  }
  .ahead:hover .maybe,
  .ahead:focus .maybe {
    stroke: var(--color-accent);
    fill: var(--color-accent-soft);
  }
  .ahead:hover .label,
  .ahead:focus .label {
    fill: var(--color-accent);
  }
  .label {
    font-size: var(--font-size-sm);
    fill: var(--color-text);
  }
  .ahead-label {
    fill: var(--color-text-muted);
  }
  .arg,
  .more {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-2xs);
    fill: var(--color-text-muted);
  }
  .real {
    fill: var(--color-text);
  }
  @media (prefers-reduced-motion: no-preference) {
    .now,
    .halo {
      transition: cx var(--motion-duration-normal) var(--motion-easing-standard);
    }
  }
</style>
