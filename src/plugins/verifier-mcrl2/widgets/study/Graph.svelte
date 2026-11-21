<!-- A graph, laid out by itself (layout.ts): nodes in layers, horizontal by default, curved arrows that start and end
     on the nodes' borders. It zooms in, out and to fit, pans when larger than its box, and switches layout. Nodes move
     smoothly when the layout changes. `notation` draws a named standard diagram in its own notation, unaltered
     (named.ts): a UML state machine's states are rounded rectangles, its initial pseudostate a filled dot, its
     transitions open arrowheads; a directed graph's nodes are circles with filled arrowheads. A node may be pinned and
     bookmarked through its marks, shown on hover and focus. -->
<script lang="ts">
  import Pannable from "../ui/components/Pannable.svelte";
  import { type Direction, layout } from "./layout.ts";
  import type { GraphEdge, GraphNode } from "./graph.ts";

  interface Props {
    label: string;
    nodes: readonly GraphNode[];
    edges: readonly GraphEdge[];
    notation?: "uml-state-machine" | "directed-graph";
    direction?: Direction;
    /** Nodes of the same layer drawn first come first: the road before the roads left. */
    order?: (a: string, b: string) => number;
    onpick?: (id: string) => void;
    pinned?: ReadonlySet<string>;
    onpin?: (id: string) => void;
    bookmarked?: ReadonlySet<string>;
    onbookmark?: (id: string) => void;
    /** Follow this node: scroll it into view when it changes. */
    follow?: string | null;
    /** Zoom to fit while the drawing is larger than its box and nobody has zoomed by hand. */
    autofit?: boolean;
    /** Place each node once and never move it as the graph grows (a path explored), at the price of more crossings. */
    stable?: boolean;
  }
  let {
    label,
    nodes,
    edges,
    notation = "directed-graph",
    direction = $bindable("horizontal"),
    order,
    onpick,
    pinned = new Set(),
    onpin,
    bookmarked = new Set(),
    onbookmark,
    follow = null,
    autofit = false,
    stable = false,
  }: Props = $props();

  const uml = $derived(notation === "uml-state-machine");
  /** The widest caption, in the drawing's units. */
  const subWidth = $derived(Math.max(0, ...nodes.map((n) => (n.sub ? Math.max(...n.sub.split("\n").map((l) => l.length)) * 6.2 : 0))));
  const size = (n: GraphNode) =>
    n.kind === "initial" ? { width: 18, height: 18 } : uml ? { width: Math.max(64, 18 + n.label.length * 8), height: 36 } : { width: 34, height: 34 };
  const placed = $derived(
    layout(
      nodes.map((n) => ({ id: n.id, ...size(n), shape: n.kind === "initial" || !uml ? ("circle" as const) : ("rounded" as const) })),
      edges.map((e) => ({ id: e.id, from: e.from, to: e.to, labelWidth: e.label ? Math.min(150, e.label.length * 6.5) : 0, labelHeight: e.label ? 14 : 0 })),
      {
        direction,
        incremental: stable,
        // Captions under the nodes need room: layers as far apart as the longest caption, rows clear of it.
        layerGap: uml ? 96 : Math.max(84, (direction === "horizontal" ? subWidth : 0) + 30),
        nodeGap: uml ? 34 : subWidth > 0 ? (direction === "horizontal" ? 66 : subWidth - 10) : 40,
        ...(order ? { order } : {}),
        ...(nodes.some((n) => n.rank !== undefined) ? { rank: Object.fromEntries(nodes.filter((n) => n.rank !== undefined).map((n) => [n.id, n.rank!])) } : {}),
      },
    ),
  );
  const byId = $derived(new Map(nodes.map((n) => [n.id, n])));
  const edgeById = $derived(new Map(edges.map((e) => [e.id, e])));

  // ---- zoom and pan
  let zoom = $state(1);
  let box: HTMLDivElement | undefined = $state();
  let boxW = $state(0);
  let boxH = $state(0);
  const fit = () => {
    if (!boxW || !boxH) return;
    zoom = Math.max(0.2, Math.min(2.5, Math.min(boxW / W, boxH / H)));
  };
  let byHand = $state(false);
  const zoomBy = (f: number) => {
    byHand = true;
    zoom = Math.max(0.2, Math.min(4, zoom * f));
  };
  /** Room around the drawing for the captions under the nodes, which may be wider than the nodes. */
  const pad = $derived(uml ? 8 : Math.max(8, subWidth / 2 - 10));
  const W = $derived(placed.width + 2 * pad);
  const H = $derived(placed.height + 2 * pad);
  $effect(() => {
    if (!autofit || byHand || !boxW || !boxH) return;
    const z = Math.min(1, boxW / W, boxH / H);
    if (Math.abs(z - zoom) > 0.01) zoom = Math.max(0.2, z);
  });

  $effect(() => {
    const id = follow;
    const p = placed.nodes.find((n) => n.id === id);
    if (!p || !box) return;
    const x = (p.x + pad) * zoom - box.clientWidth / 2;
    const y = (p.y + pad) * zoom - box.clientHeight / 2;
    box.scrollTo({ left: Math.max(0, x), top: Math.max(0, y), behavior: "smooth" });
  });

  const arrow = (x: number, y: number, a: number) => {
    const r = (a * Math.PI) / 180;
    const back = (d: number, side: number) => {
      const t = r + Math.PI + side * 0.42;
      return `${x + Math.cos(t) * d},${y + Math.sin(t) * d}`;
    };
    return uml ? `M ${back(9, -1)} L ${x},${y} L ${back(9, 1)}` : `M ${back(9, -1)} L ${x},${y} L ${back(9, 1)} Z`;
  };
</script>

<div class="graph">
  <div class="controls" role="toolbar" aria-label="{label}: layout and zoom">
    <button class:on={direction === "horizontal"} onclick={() => (direction = "horizontal")}>horizontal</button>
    <button class:on={direction === "vertical"} onclick={() => (direction = "vertical")}>vertical</button>
    <span class="sep"></span>
    <button aria-label="Zoom out" onclick={() => zoomBy(1 / 1.25)}>−</button>
    <span class="pct">{Math.round(zoom * 100)}%</span>
    <button aria-label="Zoom in" onclick={() => zoomBy(1.25)}>+</button>
    <button onclick={() => ((byHand = true), fit())}>fit</button>
  </div>
  <Pannable {label} class="pan" ignore=".node, .mark" bind:box>
    <div class="measure" bind:clientWidth={boxW} bind:clientHeight={boxH}>
      <svg
        width={W * zoom}
        height={H * zoom}
        viewBox="{-pad} {-pad} {W} {H}"
        role="img"
        aria-label={label}
      >
        {#each placed.edges as pe (pe.id)}
          {@const e = edgeById.get(pe.id)}
          <g class="edge {e?.cls ?? ''}" class:back={pe.back}>
            <path class="line" d={pe.path} />
            <path class="head" class:open={uml} d={arrow(pe.arrow.x, pe.arrow.y, pe.arrow.angle)} />
            {#if e?.label}<text class="elabel" x={pe.label.x} y={pe.label.y} text-anchor="middle">{e.label}</text>{/if}
            {#if e?.title}<title>{e.title}</title>{/if}
          </g>
        {/each}
        {#each placed.nodes as pn (pn.id)}
          {@const n = byId.get(pn.id)}
          {#if n}
            <g class="place" style:transform="translate({pn.x}px, {pn.y}px)">
              <g
                class="node {n.cls ?? ''}"
                class:pinned={pinned.has(n.id)}
                role="button"
                tabindex="0"
                aria-label={n.title ?? n.label}
                onclick={() => onpick?.(n.id)}
                onkeydown={(ev) => ev.key === "Enter" && onpick?.(n.id)}
              >
                {#if n.kind === "initial"}
                  <circle class="initial" r="8" />
                {:else if uml}
                  <rect class="shape" x={-pn.width / 2} y={-pn.height / 2} width={pn.width} height={pn.height} rx="12" />
                  <text class="nlabel" y="4" text-anchor="middle">{n.label}</text>
                {:else}
                  <circle class="shape" r={pn.width / 2} />
                  <text class="nlabel" y="4" text-anchor="middle">{n.label}</text>
                {/if}
                {#if n.sub}
                  <text class="nsub" y={pn.height / 2 + 14} text-anchor="middle">
                    {#each n.sub.split("\n") as line, li (li)}<tspan x="0" dy={li === 0 ? 0 : 13}>{line}</tspan>{/each}
                  </text>
                {/if}
                {#if n.title}<title>{n.title}</title>{/if}
              </g>
              {#if onpin && n.kind !== "initial"}
                <g
                  class="mark pin"
                  class:set={pinned.has(n.id)}
                  role="button"
                  tabindex="0"
                  aria-label={pinned.has(n.id) ? `unpin ${n.label}` : `pin ${n.label}, so it never fades`}
                  transform="translate({pn.width / 2 - 2}, {-pn.height / 2 - 6})"
                  onclick={() => onpin?.(n.id)}
                  onkeydown={(ev) => ev.key === "Enter" && onpin?.(n.id)}
                >
                  <circle class="hit" r="9" />
                  <circle class="pinhead" cy="-2" r="3.6" />
                  <line class="pinneedle" x1="0" y1="1.5" x2="0" y2="7" />
                  <title>{pinned.has(n.id) ? "Unpin" : "Pin: it never fades"}</title>
                </g>
              {/if}
              {#if onbookmark && n.kind !== "initial"}
                <g
                  class="mark star"
                  class:set={bookmarked.has(n.id)}
                  role="button"
                  tabindex="0"
                  aria-label={bookmarked.has(n.id) ? `remove the bookmark of ${n.label}` : `bookmark ${n.label}`}
                  transform="translate({-pn.width / 2 + 2}, {-pn.height / 2 - 6})"
                  onclick={() => onbookmark?.(n.id)}
                  onkeydown={(ev) => ev.key === "Enter" && onbookmark?.(n.id)}
                >
                  <circle class="hit" r="9" />
                  <path class="starshape" d="M0,-5 L1.5,-1.6 L5,-1.6 L2.2,0.7 L3.2,4.4 L0,2.2 L-3.2,4.4 L-2.2,0.7 L-5,-1.6 L-1.5,-1.6 Z" />
                  <title>{bookmarked.has(n.id) ? "Remove the bookmark" : "Bookmark it"}</title>
                </g>
              {/if}
            </g>
          {/if}
        {/each}
      </svg>
    </div>
  </Pannable>
</div>

<style>
  .graph {
    display: flex;
    flex-direction: column;
    block-size: 100%;
    min-block-size: 0;
    gap: var(--space-xs);
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
    padding: var(--space-none) var(--space-sm);
    color: var(--color-text-muted);
    background: none;
    border: var(--border-width-thin) solid transparent;
    border-radius: var(--radius-full);
    cursor: pointer;
  }
  .controls button:hover {
    color: var(--color-accent);
  }
  .controls button.on {
    color: var(--color-text);
    border-color: var(--color-border-strong);
  }
  .sep {
    flex: 1;
  }
  .pct {
    min-inline-size: var(--size-target);
    text-align: center;
  }
  .graph :global(.pan) {
    flex: 1;
    min-block-size: 0;
    overflow: auto;
  }
  .measure {
    min-inline-size: 100%;
    min-block-size: 100%;
    display: grid;
    place-items: center;
  }
  svg {
    display: block;
  }
  text {
    font-family: var(--font-family-body);
  }
  .place {
    transition: transform var(--motion-duration-settle) var(--motion-easing-standard), opacity var(--motion-duration-settle) var(--motion-easing-standard);
  }
  @media (prefers-reduced-motion: reduce) {
    .place {
      transition: none;
    }
  }

  /* ---- edges: the road solid, the roads left dashed and faint, what may come dotted */
  .line {
    fill: none;
    stroke: var(--color-text-muted);
    stroke-width: 1.3;
  }
  .head {
    fill: var(--color-text-muted);
    stroke: var(--color-text-muted);
    stroke-width: 1.3;
    stroke-linejoin: round;
  }
  .edge.road .line,
  .edge.road .head {
    stroke: var(--color-text);
  }
  .edge.road .head {
    fill: var(--color-text);
  }
  /* UML: a transition's arrowhead is open. */
  .edge .head.open {
    fill: none;
  }
  .edge.faded {
    opacity: 0.38;
  }
  .edge.faded .line {
    stroke-dasharray: 5 4;
  }
  .edge.ahead .line {
    stroke-dasharray: 1.5 4;
    stroke-linecap: round;
  }
  .edge.ahead {
    opacity: 0.55;
  }
  .elabel {
    font-size: var(--font-size-2xs);
    fill: var(--color-text-muted);
    paint-order: stroke;
    stroke: var(--color-surface-raised);
    stroke-width: 4;
    stroke-linejoin: round;
  }
  .edge.road .elabel {
    fill: var(--color-text);
  }

  /* ---- nodes */
  .node {
    cursor: pointer;
  }
  .shape {
    fill: var(--color-surface-raised);
    stroke: var(--color-text);
    stroke-width: 1.4;
  }
  .initial {
    fill: var(--color-text);
  }
  .nlabel {
    font-size: var(--font-size-xs);
    fill: var(--color-text);
  }
  .nsub {
    font-size: var(--font-size-2xs);
    fill: var(--color-text-muted);
  }
  .node:hover .shape,
  .node:focus .shape {
    stroke: var(--color-accent);
  }
  .node.current .shape {
    fill: var(--color-accent);
    stroke: var(--color-accent);
  }
  .node.current .nlabel {
    fill: var(--color-on-accent);
  }
  .node.faded {
    opacity: 0.38;
  }
  .node.faded.pinned {
    opacity: 1;
  }
  .node.ahead .shape {
    fill: none;
    stroke: var(--color-text-muted);
    stroke-dasharray: 2 3;
  }
  .node.ahead .nlabel {
    fill: var(--color-text-muted);
  }
  .node.run .shape {
    fill: var(--color-accent);
    stroke: var(--color-accent);
  }
  .node.run .nlabel,
  .node.done .nlabel,
  .node.queue .nlabel {
    fill: var(--color-surface-raised);
  }
  .node.ask .shape {
    stroke: var(--color-accent);
    stroke-width: 2.6;
  }
  .node.queue .shape {
    fill: var(--color-text-muted);
    stroke: var(--color-text-muted);
  }
  .node.done .shape {
    fill: var(--color-text);
  }
  .node.held .shape {
    stroke-dasharray: 2 3;
  }
  .node.fail .shape {
    stroke: var(--color-danger);
  }
  .node.picked .shape {
    stroke: var(--color-accent);
    stroke-width: 3;
  }
  .node.goal .shape {
    stroke-width: 3;
  }

  /* ---- the marks: pin and bookmark, shown on hover and focus, always when set */
  .mark {
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .place:hover .mark,
  .place:focus-within .mark,
  .mark.set {
    opacity: 1;
  }
  .hit {
    fill: transparent;
  }
  .pinhead {
    fill: none;
    stroke: var(--color-text-muted);
    stroke-width: 1.4;
  }
  .pinneedle {
    stroke: var(--color-text-muted);
    stroke-width: 1.4;
  }
  .pin.set .pinhead {
    fill: var(--color-accent);
    stroke: var(--color-accent);
  }
  .pin.set .pinneedle {
    stroke: var(--color-accent);
  }
  .starshape {
    fill: none;
    stroke: var(--color-text-muted);
    stroke-width: 1.2;
    stroke-linejoin: round;
  }
  .star.set .starshape {
    fill: var(--color-accent);
    stroke: var(--color-accent);
  }
  .mark:hover .pinhead,
  .mark:hover .pinneedle,
  .mark:hover .starshape {
    stroke: var(--color-accent);
  }
</style>
