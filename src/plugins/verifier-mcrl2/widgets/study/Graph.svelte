<!-- A graph, laid out by itself (layout.ts): nodes in layers, horizontal by default, curved arrows that start and end
     on the nodes' borders. It zooms in, out and to fit, pans when larger than its box, and switches layout. Nodes move
     smoothly when the layout changes. `notation` draws a named standard diagram in its own notation, unaltered
     (named.ts): a UML state machine's states are rounded rectangles, its initial pseudostate a filled dot, its
     transitions open arrowheads; a directed graph's nodes are circles with filled arrowheads. A node may be pinned and
     bookmarked through its marks, shown on hover and focus. -->
<script lang="ts">
  import { untrack } from "svelte";
  import Pannable from "../Pannable.svelte";
  import { type Direction, type Layout, layout } from "./layout.ts";
  import { arrowOf, pathOf, route } from "./route.ts";
  import Icon from "../Icon.svelte";
  import Action from "./Action.svelte";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Auto from "@lucide/svelte/icons/wand-sparkles";
  import Compact from "@lucide/svelte/icons/fold-horizontal";
  import Spread from "@lucide/svelte/icons/unfold-horizontal";
  import ZoomIn from "@lucide/svelte/icons/zoom-in";
  import ZoomOut from "@lucide/svelte/icons/zoom-out";
  import Fit from "@lucide/svelte/icons/scan";
  import Layered from "@lucide/svelte/icons/network";
  import Radial from "@lucide/svelte/icons/orbit";
  import Force from "@lucide/svelte/icons/atom";
  import GridIcon from "@lucide/svelte/icons/grid-3x3";
  import { type Algorithm, redraw } from "./algorithms.ts";
  import type { GraphEdge, GraphNode } from "./graph.ts";

  interface Props {
    label: string;
    nodes: readonly GraphNode[];
    edges: readonly GraphEdge[];
    /** uml-state-machine and directed-graph are named notations (named.ts); path is the timeline's own drawing, a
     * path of states on a line with the steps possible now fanning out, which is no standard and is never called one. */
    notation?: "uml-state-machine" | "directed-graph" | "path";
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
    /** Where the flow goes at first: auto lets the card's shape decide (horizontal in a wide card, vertical in a tall one). */
    orient?: "right" | "down" | "left" | "up" | "auto";
    /** Place each node once and never move it as the graph grows (a path explored), at the price of more crossings. */
    stable?: boolean;
    /** The card gives the graph no height of its own (its height is its contents'): the window has a least of its own. */
    grow?: boolean;
  }
  let {
    label,
    nodes,
    edges,
    notation = "directed-graph",
    direction = "horizontal",
    order,
    onpick,
    pinned = new Set(),
    onpin,
    bookmarked = new Set(),
    onbookmark,
    follow = null,
    autofit = false,
    orient: initialOrient,
    stable = false,
    grow = false,
  }: Props = $props();

  const uml = $derived(notation === "uml-state-machine");
  const path = $derived(notation === "path");
  const isAhead = (n: GraphNode) => (n.cls ?? "").split(" ").includes("ahead");
  const isCurrent = (n: GraphNode) => (n.cls ?? "").split(" ").includes("current");
  /** In a path, the widest label on a step: the layers are that far apart, so no label covers another. */
  const edgeWidth = $derived(Math.max(0, ...edges.filter((e) => !(e.cls ?? "").includes("ahead")).map((e) => (e.label ? e.label.length * 6.6 : 0))));
  /** The widest caption, in the drawing's units. */
  const subWidth = $derived(Math.max(0, ...nodes.map((n) => (n.sub ? Math.max(...n.sub.split("\n").map((l) => l.length)) * 6.2 : 0))));
  const size = (n: GraphNode) =>
    n.kind === "initial"
      ? { width: 18, height: 18 }
      : uml
      ? { width: Math.max(64, 18 + n.label.length * 8), height: 36 }
      : path
      ? isCurrent(n) ? { width: 26, height: 26 } : { width: 16, height: 16 }
      : { width: 34, height: 34 };
  /** The card's box, which "auto" reads to choose where the flow goes, and fit reads to zoom. */
  let boxW = $state(0);
  let boxH = $state(0);
  // ---- the layout chosen: where the flow goes (or the card's shape decides), and how much room it takes
  type Orient = "right" | "down" | "left" | "up" | "auto";
  // The flow at first, from the props once: afterwards it is the person's choice.
  let orient = $state<Orient>(untrack(() => initialOrient ?? (direction === "vertical" ? "down" : "right")));
  let spacing = $state(1);
  const flow: Exclude<Orient, "auto"> = $derived(orient === "auto" ? (boxH > boxW * 1.15 ? "down" : "right") : orient);
  const dir: Direction = $derived(flow === "down" || flow === "up" ? "vertical" : "horizontal");
  const laid = $derived(
    layout(
      nodes.map((n) => ({ id: n.id, ...size(n), shape: n.kind === "initial" || !uml ? ("circle" as const) : ("rounded" as const) })),
      edges.map((e) => ({ id: e.id, from: e.from, to: e.to, labelWidth: e.label ? Math.min(150, e.label.length * 6.5) : 0, labelHeight: e.label ? 14 : 0 })),
      {
        direction: dir,
        incremental: stable,
        // Captions under the nodes need room: layers as far apart as the longest caption, rows clear of it.
        layerGap: spacing * (uml ? 96 : path ? (dir === "horizontal" ? Math.max(90, Math.min(150, edgeWidth + 24)) : 64) : dir === "horizontal" ? Math.max(84, subWidth + 30) : 76),
        nodeGap: spacing * (uml ? 34 : path ? (dir === "horizontal" ? 22 : 60) : subWidth > 0 ? (dir === "horizontal" ? 58 : subWidth + 24) : 40),
        ...(order ? { order } : {}),
        ...(nodes.some((n) => n.rank !== undefined) ? { rank: Object.fromEntries(nodes.filter((n) => n.rank !== undefined).map((n) => [n.id, n.rank!])) } : {}),
      },
    ),
  );
  /** The layout turned to flow right to left, or bottom to top: mirrored, arrows turned with it. */
  const mirror = (l: Layout, fx: boolean, fy: boolean): Layout => {
    if (!fx && !fy) return l;
    const X = (x: number) => (fx ? l.width - x : x);
    const Y = (y: number) => (fy ? l.height - y : y);
    const pt = ([x, y]: [number, number]): [number, number] => [X(x), Y(y)];
    return {
      ...l,
      nodes: l.nodes.map((n) => ({ ...n, x: X(n.x), y: Y(n.y) })),
      edges: l.edges.map((e) => {
        const points = e.points.map(pt);
        return { ...e, points, path: pathOf(points), arrow: arrowOf(points), label: { x: X(e.label.x), y: Y(e.label.y) } };
      }),
    };
  };
  /** Edge labels' and fanned words' widths, in the drawing's units. */
  const labelW = (id: string) => {
    const e = edges.find((x) => x.id === id);
    return e?.label ? e.label.length * (path ? 6.6 : 6) : 0;
  };
  const fanW = (id: string) => {
    const n = byId.get(id);
    return n ? (n.label.length + (n.sub?.length ?? 0)) * 6.6 + 12 : 0;
  };
  const routed = $derived(
    route(laid, dir, {
      ...(path
        ? {
          fan: nodes.filter(isAhead).map((n) => n.id),
          fanFrom: nodes.find(isCurrent)?.id ?? null,
          avoid: nodes.filter((n) => (n.cls ?? "").split(" ").includes("faded")).map((n) => n.id),
        }
        : {}),
      fanWidth: fanW,
      labelWidth: labelW,
    }),
  );
  /** How the graph is drawn: in layers (with its flow), or around a centre, as springs, in rows. */
  let algorithm: Algorithm = $state("layered");
  const placed = $derived(
    algorithm === "layered" ? mirror(routed, flow === "left", flow === "up") : redraw(laid, algorithm, { gap: 90 * spacing }),
  );

  // ---- moving: nodes and arrows glide together from the old layout to the new one, the arrows always on the nodes
  let shown: Layout = $state.raw({ nodes: [], edges: [], width: 0, height: 0 });
  let frame = 0;
  $effect(() => {
    const to = placed;
    // Where the glide starts is read without subscribing: the glide writes `shown` every frame, and an effect that
    // depended on it would restart the glide each frame, so the drawing would approach its place forever.
    const from = untrack(() => shown);
    cancelAnimationFrame(frame);
    const ms = motionMs();
    if (ms <= 0 || from.nodes.length === 0) {
      shown = to;
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      shown = between(from, to, 1 - (1 - t) * (1 - t));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  });
  const byId = $derived(new Map(nodes.map((n) => [n.id, n])));
  /** Several loops on one node: their labels are stacked, one line each, never on top of each other. */
  const loopLine = $derived.by(() => {
    const seen = new Map<string, number>();
    const out = new Map<string, number>();
    for (const e of edges) {
      if (e.from !== e.to) continue;
      const k = seen.get(e.from) ?? 0;
      out.set(e.id, k);
      seen.set(e.from, k + 1);
    }
    return out;
  });
  const edgeById = $derived(new Map(edges.map((e) => [e.id, e])));

  // ---- zoom and pan. Fit is the browser's: the drawing scaled to its window by CSS (preserveAspectRatio), nothing
  // computed. A zoom is a scale the person chose, from 1 (the drawing's own size) up or down.
  // Under a finger the drawing is not shrunk to fit: its targets keep the size a finger needs, and it pans.
  const finger = globalThis.matchMedia?.("(pointer: coarse)").matches ?? false;
  let zoom: number | null = $state(untrack(() => (autofit && !finger ? null : 1)));
  let box: HTMLDivElement | undefined = $state();
  const fit = () => (zoom = null);
  const zoomBy = (f: number) => (zoom = Math.max(0.2, Math.min(4, (zoom ?? 1) * f)));
  /** Room around the drawing for the captions under the nodes, which may be wider than the nodes. */
  const pad = $derived(uml ? 8 : path ? 20 : Math.max(8, subWidth / 2 - 10));
  const W = $derived(placed.width + 2 * pad);
  const H = $derived(placed.height + 2 * pad);
  let drawing: SVGSVGElement | undefined = $state();

  // The node followed is brought into view by the browser, when the drawing is larger than its window.
  // Only when the followed node changes (a step taken, a state chosen): between moves, the person pans freely.
  let followed: string | null = null;
  $effect(() => {
    const id = follow;
    if (!id || id === followed || zoom === null || !drawing) return;
    followed = id;
    const d = drawing;
    // After the glide, where the node will be.
    setTimeout(() => {
      const el = [...d.querySelectorAll<SVGGElement>("g.node")].find((g) => g.dataset["id"] === id);
      // Only the graph's own window scrolls to it: never the card, the mosaic or the page around it.
      const pan = d.closest<HTMLElement>(".pan");
      if (!el || !pan) return;
      const a = el.getBoundingClientRect();
      const b = pan.getBoundingClientRect();
      pan.scrollTo({ left: pan.scrollLeft + a.left + a.width / 2 - b.left - b.width / 2, top: pan.scrollTop + a.top + a.height / 2 - b.top - b.height / 2, behavior: "smooth" });
    }, motionMs());
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

<script module lang="ts">
  import type { Layout as L } from "./layout.ts";
  import { arrowOf as arrowAt, pathOf as pathThrough } from "./route.ts";
  type P = [number, number];
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  /** A layout part of the way from one to another: nodes and the points of each edge move together. */
  export function between(a: L, b: L, t: number): L {
    const na = new Map(a.nodes.map((n) => [n.id, n]));
    const ea = new Map(a.edges.map((e) => [e.id, e]));
    return {
      width: lerp(a.width, b.width, t),
      height: lerp(a.height, b.height, t),
      nodes: b.nodes.map((n) => {
        const o = na.get(n.id);
        return o ? { ...n, x: lerp(o.x, n.x, t), y: lerp(o.y, n.y, t) } : n;
      }),
      edges: b.edges.map((e) => {
        const o = ea.get(e.id);
        if (!o || o.points.length !== e.points.length) return e;
        const points = e.points.map((q, i): P => [lerp(o.points[i]![0], q[0], t), lerp(o.points[i]![1], q[1], t)]);
        return { ...e, points, path: pathThrough(points), arrow: arrowAt(points), label: { x: lerp(o.label.x, e.label.x, t), y: lerp(o.label.y, e.label.y, t) } };
      }),
    };
  }
  /** How long a move takes: the motion token's, none when the person asked for less motion. */
  export function motionMs(): number {
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 0;
    const v = getComputedStyle(document.documentElement).getPropertyValue("--motion-duration-normal").trim();
    const n = parseFloat(v);
    return Number.isFinite(n) ? (v.endsWith("ms") ? n : n * 1000) : 0;
  }
</script>

<div class="graph">
  <div class="controls" role="toolbar" aria-label="{label}: layout and zoom">
    {#if !path}
      {#each [["layered", "In layers, along the flow", Layered], ["radial", "Around a centre", Radial], ["force", "As springs: linked nodes together", Force], ["grid", "In rows", GridIcon]] as const as [a, says, I] (a)}
        <button class="ico" class:on={algorithm === a} aria-label={says} title={says} aria-pressed={algorithm === a} onclick={() => (algorithm = a)}><Icon><I /></Icon></button>
      {/each}
      <span class="gap"></span>
    {/if}
    {#if algorithm === "layered"}
      {#each [["right", "Flow left to right", ArrowRight], ["down", "Flow top to bottom", ArrowDown], ["left", "Flow right to left", ArrowLeft], ["up", "Flow bottom to top", ArrowUp], ["auto", "Flow as the card's shape suits", Auto]] as const as [o, says, I] (o)}
        <button class="ico" class:on={orient === o} aria-label={says} title={says} aria-pressed={orient === o} onclick={() => (orient = o)}><Icon><I /></Icon></button>
      {/each}
    {/if}
    <span class="gap"></span>
    <button class="ico" aria-label="Closer together" title="Closer together" disabled={spacing <= 0.6} onclick={() => (spacing = Math.max(0.6, spacing / 1.25))}><Icon><Compact /></Icon></button>
    <button class="ico" aria-label="Further apart" title="Further apart" disabled={spacing >= 2} onclick={() => (spacing = Math.min(2, spacing * 1.25))}><Icon><Spread /></Icon></button>
    <span class="sep"></span>
    <button class="ico" aria-label="Zoom out" title="Zoom out" onclick={() => zoomBy(1 / 1.25)}><Icon><ZoomOut /></Icon></button>
    <!-- A readout, never a button: fitted, it says so quietly; zoomed, its percentage, and Fit is the action back. -->
    <span class="pct" class:quiet={zoom === null} role="status" title={zoom === null ? "The whole drawing fits the card" : "How large the drawing is drawn"}>{zoom === null ? "all in view" : `${Math.round(zoom * 100)}%`}</span>
    <button class="ico" aria-label="Zoom in" title="Zoom in" onclick={() => zoomBy(1.25)}><Icon><ZoomIn /></Icon></button>
    {#if zoom !== null}<Action size="sm" icon={Fit} label="Fit" hint="fit the whole drawing in the card" onclick={fit} />{/if}
  </div>
  <!-- The window the drawing is seen through: its size is the card's, never the drawing's. -->
  <div class="window" class:grow bind:clientWidth={boxW} bind:clientHeight={boxH}>
  <Pannable {label} class="pan" ignore=".node, .mark" bind:box>
    <div class="measure" class:fitting={zoom === null}>
      <svg
        bind:this={drawing}
        class:fit={zoom === null}
        width={zoom === null ? undefined : W * zoom}
        height={zoom === null ? undefined : H * zoom}
        viewBox="{-pad} {-pad} {W} {H}"
        role="group"
        aria-label={label}
      >
        {#each shown.edges as pe (pe.id)}
          {@const e = edgeById.get(pe.id)}
          <g class="edge {e?.cls ?? ''}" class:back={pe.back}>
            <path class="line" d={pe.path} />
            {#if !path || pe.back || pe.self}
              <path class="head" class:open={uml} d={arrow(pe.arrow.x, pe.arrow.y, pe.arrow.angle)} />
            {/if}
            {#if e?.label}<text class="elabel" class:big={path} x={pe.label.x} y={pe.label.y - (loopLine.get(pe.id) ?? 0) * 15} text-anchor="middle">{e.label}</text>{/if}
            {#if e?.title}<title>{e.title}</title>{/if}
          </g>
        {/each}
        {#each shown.nodes as pn (pn.id)}
          {@const n = byId.get(pn.id)}
          {#if n}
            <g class="place" style:transform="translate({pn.x}px, {pn.y}px)">
              <g
                data-id={n.id}
                class="node {n.cls ?? ''}"
                class:pinned={pinned.has(n.id)}
                role="button"
                tabindex="0"
                aria-label={n.title ?? n.label}
                onclick={() => onpick?.(n.id)}
                onkeydown={(ev) => ev.key === "Enter" && onpick?.(n.id)}
              >
                <rect class="pad" x={-Math.max(pn.width, 48) / 2} y={-Math.max(pn.height, 48) / 2} width={Math.max(pn.width, 48)} height={Math.max(pn.height, 48)} />
                {#if n.kind === "initial"}
                  <circle class="initial" r="8" />
                {:else if uml}
                  <rect class="shape" x={-pn.width / 2} y={-pn.height / 2} width={pn.width} height={pn.height} rx="12" />
                  <text class="nlabel" y="4" text-anchor="middle">{n.label}</text>
                {:else if path}
                  {#if isCurrent(n)}
                    <circle class="halo" r="17" />
                    <circle class="disc" r="11" />
                  {:else if isAhead(n)}
                    <circle class="maybe" r="6" />
                    <text class="aword" x={flow === "left" ? -14 : 14} y="4" text-anchor={flow === "left" ? "end" : "start"}>{n.label}{#if n.sub}<tspan class="aarg" dx="6">{n.sub}</tspan>{/if}</text>
                  {:else}
                    <circle class="dot" r="7" />
                  {/if}
                  {#if !isAhead(n) && n.label}
                    {#if dir === "vertical"}
                      <text class="pname" x={isCurrent(n) ? 22 : 13} y="4" text-anchor="start">{n.label}</text>
                    {:else}
                      <text class="pname" y={isCurrent(n) ? 32 : 22} text-anchor="middle">{n.label}</text>
                    {/if}
                  {/if}
                {:else}
                  <circle class="shape" r={pn.width / 2} />
                  <text class="nlabel" y="4" text-anchor="middle">{n.label}</text>
                {/if}
                {#if n.sub && !path}
                  {#if dir === "vertical" && algorithm === "layered"}
                    <text class="nsub" x={pn.width / 2 + 8} y={n.sub.includes("\n") ? -3 : 4} text-anchor="start">
                      {#each n.sub.split("\n") as line, li (li)}<tspan x={pn.width / 2 + 8} dy={li === 0 ? 0 : 13}>{line}</tspan>{/each}
                    </text>
                  {:else}
                    <text class="nsub" y={pn.height / 2 + 14} text-anchor="middle">
                      {#each n.sub.split("\n") as line, li (li)}<tspan x="0" dy={li === 0 ? 0 : 13}>{line}</tspan>{/each}
                    </text>
                  {/if}
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
    flex-wrap: wrap;
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
  .controls button:focus-visible,
  .node:focus-visible,
  .mark:focus-visible {
    outline: var(--border-width-focus) solid var(--color-focus);
  }
  .controls .ico {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-none);
  }
  .controls button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .gap {
    inline-size: var(--space-sm);
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
    cursor: default;
    user-select: none;
  }
  .pct.quiet {
    font-style: italic;
    color: var(--color-text-muted);
  }
  /* The window takes the height the card gives; with `grow`, a card that gives none has a least of one. */
  .window {
    position: relative;
    flex: 1;
    min-block-size: 0;
  }
  .window.grow {
    min-block-size: var(--size-w-16);
  }
  .graph :global(.pan) {
    position: absolute;
    inset: 0;
    overflow: auto;
  }
  .measure.fitting {
    inline-size: 100%;
    block-size: 100%;
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
  svg.fit {
    inline-size: 100%;
    block-size: 100%;
  }
  text {
    font-family: var(--font-family-body);
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
    border: var(--border-width-thin) solid transparent;
  }
  /* The padding that brings a node to a finger's size, drawn in nothing, only where the pointer is a finger. */
  .pad {
    display: none;
    fill: transparent;
  }
  @media (pointer: coarse) {
    .pad {
      display: inline;
    }
    .controls button {
      min-block-size: var(--size-control);
      min-inline-size: var(--size-control);
    }
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

  /* ---- a path: the timeline's drawing */
  .dot {
    fill: var(--color-surface-raised);
    stroke: var(--color-text);
    stroke-width: 1.4;
  }
  .disc {
    fill: var(--color-accent);
  }
  .halo {
    fill: none;
    stroke: var(--color-accent);
    stroke-width: 1;
    opacity: 0.45;
  }
  .maybe {
    fill: none;
    stroke: var(--color-text-muted);
    stroke-width: 1.2;
  }
  .aword {
    font-size: var(--font-size-sm);
    fill: var(--color-text-muted);
  }
  .aarg {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-2xs);
  }
  .node:hover .maybe,
  .node:focus .maybe {
    stroke: var(--color-accent);
    fill: var(--color-accent-soft);
  }
  .node:hover .aword,
  .node:focus .aword {
    fill: var(--color-accent);
  }
  .node:hover .dot,
  .node:focus .dot {
    stroke: var(--color-accent);
  }
  .pname {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-2xs);
    fill: var(--color-text-muted);
  }
  .elabel.big {
    font-size: var(--font-size-sm);
  }
  .node.ahead {
    opacity: 1;
  }

  /* ---- the marks: pin and bookmark, shown on hover and focus, always when set */
  /* A mark nobody can see takes no clicks: a hidden mark of one state would otherwise sit over its neighbour. */
  .mark {
    cursor: pointer;
    border: var(--border-width-thin) solid transparent;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--motion-duration-fast) var(--motion-easing-standard);
  }
  .place:focus-within .mark,
  .mark.set {
    opacity: 1;
    pointer-events: auto;
  }
  @media (hover: hover) {
    .place:hover .mark {
      opacity: 1;
      pointer-events: auto;
    }
  }
  /* Where nothing hovers (a finger) the marks are always there, faint, and as large as a finger needs. */
  @media (hover: none) {
    .mark:not(.set) {
      opacity: 0.55;
      pointer-events: auto;
    }
    .mark :global(.hit) {
      r: calc(var(--size-control) / 2);
    }
  }
  /* On the current state the marks are always there, faint, so that a person finds them. */
  .place:has(.node.current) .mark:not(.set) {
    opacity: 0.55;
    pointer-events: auto;
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
