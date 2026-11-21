<!-- The lock's view in Naima's Models tab. Three parts: buttons that let you be the clients,
     a UML state machine of each client with the state it is in now, and the conversation
     between the clients and the lock as a UML sequence diagram. Everything drawn is the
     lock's state, the observer's memory, or a step the lock's guards allow now. -->
<script lang="ts">
  import { onMount } from "svelte";
  import Graph from "@naima/study/Graph.svelte";
  import Sequence from "@naima/study/Sequence.svelte";
  import type { GraphEdge, GraphNode } from "@naima/study/graph.ts";
  import { at, CLIENTS, type Data, type Host, LOCK } from "./types.ts";
  import type { Memory } from "./observer.svelte.ts";

  let { host }: { host: Host } = $props();

  // The latest data from the tab, kept in this component's own state: what the host has
  // now, then each new data it sends.
  let data: Data<Memory> | null = $state(null);
  onMount(() => {
    data = host.data as Data<Memory> | null;
    return host.subscribe((d) => (data = d as Data<Memory>));
  });

  const lock = $derived(data?.state ?? null);
  const memory = $derived(data?.memory ?? null);

  // ---- firing: a button is enabled only when its step is among the allowed ones
  let refusal: string | null = $state(null);
  const allowed = (label: string) => (data?.allowed ?? []).some((a) => a.label === label);

  async function fire(label: string) {
    const r = await host.fire(label);
    refusal = r.ok ? null : (r.why ?? "not allowed now");
  }

  // ---- a client's state machine, in UML notation: an initial pseudostate and three states
  const STATES = [
    { id: "IDLE", label: "idle" },
    { id: "WAITING", label: "waiting" },
    { id: "HOLDING", label: "holding" },
  ];
  const EDGES: GraphEdge[] = [
    { id: "start", from: "init", to: "IDLE" },
    { id: "ask", from: "IDLE", to: "WAITING", label: "ask" },
    { id: "grant", from: "WAITING", to: "HOLDING", label: "grant" },
    { id: "release", from: "HOLDING", to: "IDLE", label: "release" },
  ];
  function machine(client: string): GraphNode[] {
    const now = lock ? at(lock.phase, client) : "IDLE";
    return [
      { id: "init", label: "", kind: "initial" },
      ...STATES.map((s) => ({ id: s.id, label: s.label, cls: s.id === now ? "current" : "" })),
    ];
  }

  // ---- how long a client has waited, in steps
  function waited(client: string): string {
    if (!memory) return "";
    const since = memory.askedAt[client];
    const now = since === undefined ? "" : `waiting for ${memory.steps - since} steps`;
    const past = memory.waits[client] ?? [];
    const before = past.length ? `waited ${past.join(", ")} before` : "";
    return [now, before].filter(Boolean).join("; ");
  }

  const lifelines = [...CLIENTS, LOCK];
</script>

<div class="study">
  <section class="clients">
    {#each CLIENTS as c (c)}
      <div class="client">
        <div class="row">
          <strong>{c}</strong>
          <button disabled={!allowed(`ask(${c})`)} title={host.say(`ask(${c})`)?.text} onclick={() => fire(`ask(${c})`)}>ask</button>
          <button disabled={!allowed(`release(${c})`)} title={host.say(`release(${c})`)?.text} onclick={() => fire(`release(${c})`)}>release</button>
        </div>
        <div class="machine">
          <Graph label="the state machine of client {c}" notation="uml-state-machine" autofit nodes={machine(c)} edges={EDGES} />
        </div>
        <p class="hint">{waited(c)}</p>
      </div>
    {/each}
  </section>

  {#if refusal}<p class="hint refused">{refusal}</p>{/if}
  <p class="hint">
    {#if lock}
      {lock.free ? "The lock is free." : `${memory?.holder ?? "A client"} holds the lock.`}
      {lock.queue.length ? `Waiting, the longest first: ${lock.queue.join(", ")}.` : "Nobody waits."}
    {/if}
  </p>

  <section class="sequence">
    <Sequence label="the clients and the lock, each step a message" {lifelines} messages={memory?.messages ?? []} />
  </section>
</div>

<style>
  .study {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px;
    font-family: var(--font-family-body);
    color: var(--color-text);
  }
  .clients {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }
  .client {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px solid var(--color-border-strong);
    border-radius: 12px;
    padding: 8px;
  }
  .machine {
    height: 200px;
  }
  .sequence {
    height: 360px;
    overflow: auto;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .hint {
    margin: 0;
    font-size: 13px;
    color: var(--color-text-muted);
  }
  .refused {
    color: var(--color-danger);
  }
  button {
    font: inherit;
    font-size: 13px;
    padding: 4px 12px;
    border-radius: 999px;
    border: 1px solid var(--color-border-strong);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
