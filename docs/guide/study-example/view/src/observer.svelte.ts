// The lock's observer: what is worth remembering about a path, folded one entry at a time.
//
// It is pure. `on` reads only its arguments and returns a new memory, so the same path
// always gives the same memory, and the tab may keep copies of it along the path and
// fold from the nearest one when the person moves back and forth.
//
// Time here is counted in steps: one entry of the path is one step.

import { CLIENTS, type Entry, LOCK, type LockState } from "./types.ts";

/** One step as a message of the UML sequence diagram. */
export interface Message {
  from: string;
  to: string;
  label: string;
  title: string;
}

export interface Memory {
  /** How many steps the path has taken so far. */
  steps: number;
  /** Who holds the lock now, or null when it is free. */
  holder: string | null;
  /** Who waits, the longest first. */
  queue: string[];
  /** For each client that waits now, the step at which it asked. */
  askedAt: Record<string, number>;
  /** For each client, how many steps each of its finished waits lasted, in order. */
  waits: Record<string, number[]>;
  /** Every step as messages between the clients and the lock, the latest ones. */
  messages: Message[];
}

/** How many messages are remembered. */
const MESSAGES = 120;

function holderOf(s: LockState): string | null {
  return CLIENTS.find((c) => s.phase.at[c] === "HOLDING") ?? null;
}

export function init(_config: unknown, s: LockState): Memory {
  return {
    steps: 0,
    holder: holderOf(s),
    queue: [...s.queue],
    askedAt: {},
    waits: Object.fromEntries(CLIENTS.map((c) => [c, []])),
    messages: [],
  };
}

export function on(m: Memory, e: Entry): Memory {
  const n: Memory = structuredClone(m);
  n.steps++;
  const who = String(e.input.args[0]);
  if (e.input.action === "ask") n.askedAt[who] = n.steps;
  n.messages.push({ from: who, to: LOCK, label: e.input.phrase ?? e.input.action, title: e.input.label });
  for (const o of e.outputs) {
    const to = String(o.args[0]);
    if (o.action === "grant" && to in n.askedAt) {
      n.waits[to] = [...(n.waits[to] ?? []), n.steps - n.askedAt[to]!];
      delete n.askedAt[to];
    }
    n.messages.push({ from: LOCK, to, label: o.phrase ?? o.action, title: o.label });
  }
  n.messages = n.messages.slice(-MESSAGES);
  n.holder = holderOf(e.after);
  n.queue = [...e.after.queue];
  return n;
}
