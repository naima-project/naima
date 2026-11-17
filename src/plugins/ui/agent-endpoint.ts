// The agent channel: how the UI's MCP server (mcp.ts) reaches the UI open on the project. It is the server's half of
// the UI stance's agent protocol: a request `{ id, tool, args }` is written for the feed `agent` (show.ts), the open
// UI runs it on its central store or on its page and answers on the bridge's command `agent-answer`, and the server
// takes the answer by its id. The tools are the store's (`store`, `transitions`, `transition`) and the page's
// (`read_page`, `screenshot`); a show of a place is the transition of one of the machine agent's sequences.
//
// The server and the UI are separate processes, so the requests meet in files (show.ts). A file holds only the newest
// request, so the channel asks one request at a time, in order: a second ask waits for the first one's answer or its
// timeout, and never takes its place (the model develop/models/ui/agent-endpoint in the workshop: one request at a
// time, a read asked again with a new id when it timed out, a transition asked once, since the page may have applied
// it before it reloaded).
//
// This file holds no UI behaviour and imports nothing of the app beyond the files' plumbing.

import { type AgentRequest, askAgent, awaitAnswer, openUis, requestId, taken } from "./show.ts"

/** The named sequence of the UI's machine agent that shows each kind of place. */
export const SHOW_SEQUENCES = { screen: "showScreen", view: "showView", item: "showItem", commit: "showCommit", line: "showLine" } as const

/**
 * The transition a show's arguments name: exactly one of screen, view, item, commit or line, as the sequence of the
 * UI's machine agent that shows it, with the name as its argument; or why it is refused. The UI decides whether it
 * knows the place; a commit is made a full hash by `hash`, which takes git and throws when the ref names no commit.
 */
export function showCall(args: { [key: string]: unknown }, hash: (ref: string) => string): { name: string; arg: string } | string {
  const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null)
  const given = Object.keys(SHOW_SEQUENCES).filter((k) => text(args[k]) !== null) as (keyof typeof SHOW_SEQUENCES)[]
  if (given.length !== 1) return "show takes exactly one of screen, view, item, commit or line"
  const kind = given[0]!
  const v = text(args[kind])!.trim()
  if (kind !== "commit") return { name: SHOW_SEQUENCES[kind], arg: v }
  try {
    return { name: SHOW_SEQUENCES.commit, arg: hash(v) }
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** An answer of the open UI: the tool's own fields, or `error` with why it has none. */
export type Answered<T> = (T & { error?: string }) | null

export interface AgentChannel {
  /** How many UIs are open on the project now. */
  open(): number
  /**
   * Asks the open UIs a request and waits up to `ms` for the answer: null when none came. A request that moves
   * the store (`transition`) is asked once; a read is asked a second time, with a new id, when the first got no answer,
   * since it can reach a page the moment it reloads, which never answers it. Returns the id of the last asking.
   */
  ask<T>(tool: AgentRequest["tool"], args: { [key: string]: unknown }, ms: number): Promise<{ id: string; answer: Answered<T> }>
  /** How many of the open UIs took the request `id`, waiting a little for every one open to. */
  took(id: string): Promise<{ open: number; took: number }>
}

/** The channel to the UIs open on the project at `root`. */
export function agentChannel(root: string): AgentChannel {
  // The asks in order: each starts when the one before it has ended, whatever it ended with.
  let tail: Promise<unknown> = Promise.resolve()
  const run = async <T>(tool: AgentRequest["tool"], args: { [key: string]: unknown }, ms: number) => {
    const once = tool === "transition"
    let id = ""
    for (const wait of once ? [ms] : [ms / 2, ms / 2]) {
      id = requestId()
      askAgent(root, { id, tool, args })
      const a = await awaitAnswer<Answered<never>>(root, id, wait)
      if (a !== null) return { id, answer: a }
    }
    return { id, answer: null }
  }
  return {
    open: () => openUis(root).length,
    ask<T>(tool: AgentRequest["tool"], args: { [key: string]: unknown }, ms: number) {
      const next = tail.then(() => run(tool, args, ms))
      tail = next.catch(() => {})
      return next as Promise<{ id: string; answer: Answered<T> }>
    },
    took: (id) => taken(root, id, 1000, "agent"),
  }
}
