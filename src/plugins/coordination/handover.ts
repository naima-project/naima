// The coordinator's handover to a fresh session: a coordinator session degrades
// as its context fills, so it measures how full the context is and, past a
// threshold, writes the session note, gives the coordinator role up and prints
// what starts its successor (features/coordinator-hands-over-fresh-session-when-context).
//
// The role is a record in the clone's state folder, shared by its worktrees and
// never committed:
//
//   <git common dir>/naima/coordinator.json   { holder, since, retired: [{ session, at }], pending? }
//
// `naima hello` in the main checkout takes the role for its session. A handover
// makes the holder nobody and lists the old session as retired; the successor's
// hello takes it. A retired session is refused by `requireWriter`, which `land`
// and the push check call: the single writer's work is never done by a session
// that gave the role up. The behaviour is modelled first: develop/models/handover/.
//
// The measure is the host's: the hook input carries the transcript, whose last
// assistant message's usage is the context size (core/adapters). A host without
// one has no measure, and nothing here guesses it.

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import {
  adapter,
  type AgentAdapter,
  bool,
  type Command,
  type Context,
  currentSession,
  gitDirsOf,
  messageLine,
  NaimaError,
  parse,
  rendered,
  stateDir,
  str,
  type SummarySection,
  trunk,
  usageError,
  writeFileAtomic,
} from "../../core/api.ts"
import type { ClaimsData } from "./index.ts"
import { claimsReports } from "./claims-reports.ts"
import { aheadBehind } from "./worktrees.ts"

// ── the options ──────────────────────────────────────────────────────────────

/** The context window, in tokens, when the project names none: the owner has not chosen it. */
export const DEFAULT_WINDOW = 200_000
/** The share of the window past which the coordinator hands over, when the project names none: the owner has not chosen it. */
export const DEFAULT_HANDOVER_AT = 0.6

export interface HandoverOptions {
  /** The window of the model the coordinator runs on, in tokens. */
  contextWindow: number
  /** The share of the window past which it hands over, above 0 and at most 1. */
  handoverAt: number
}

/** The options as the project gives them, validated: a malformed one fails loading, naming it. */
export function readHandoverOptions(o: Record<string, unknown>): HandoverOptions {
  const window = o["contextWindow"] ?? DEFAULT_WINDOW
  if (typeof window !== "number" || !Number.isInteger(window) || window < 1) {
    throw new Error(`coordination: options.contextWindow is not a positive whole number of tokens, got ${JSON.stringify(window)}`)
  }
  const at = o["handoverAt"] ?? DEFAULT_HANDOVER_AT
  if (typeof at !== "number" || !(at > 0) || at > 1) {
    throw new Error(`coordination: options.handoverAt is not a share of the window above 0 and at most 1, got ${JSON.stringify(at)}`)
  }
  return { contextWindow: window, handoverAt: at }
}

/** The depth of the context against the threshold. */
export interface Depth {
  tokens: number
  window: number
  /** The share of the window the context fills. */
  share: number
  /** The tokens past which the coordinator hands over. */
  limit: number
  past: boolean
}

/** The limit in tokens: the window times the share, rounded down. */
export const limitOf = (o: HandoverOptions): number => Math.floor(o.contextWindow * o.handoverAt)

/** How deep the context is, against the threshold. Undefined with no measure: the host gives none, and a number is never guessed. */
export function depthOf(tokens: number | undefined, o: HandoverOptions): Depth | undefined {
  if (tokens === undefined || !Number.isFinite(tokens) || tokens < 0) return undefined
  const limit = limitOf(o)
  return { tokens, window: o.contextWindow, share: tokens / o.contextWindow, limit, past: tokens >= limit }
}

const percent = (share: number): string => `${Math.round(share * 100)}%`

// ── the role record ──────────────────────────────────────────────────────────

/** A session that gave the role up. */
export interface Retired {
  session: string
  at: string
}

export interface Role {
  /** The session that is the coordinator; null between a handover and the successor taking the role. */
  holder: string | null
  since: string
  retired: Retired[]
  /** A handover made and not yet taken: who gave the role up, when, and the session note it wrote. */
  pending?: { from: string; at: string; note: string }
}

/** The role record's file; null outside git. */
const roleFile = (root: string): string | null => {
  const dir = stateDir(root)
  return dir ? join(dir, "coordinator.json") : null
}

/** The limit the turn-end script compares the context with, left in the tick's folder, so it needs no Deno; present only while a coordinator holds the role. */
const limitFile = (root: string): string | null => {
  const dir = stateDir(root)
  return dir ? join(dir, "tick", "handover-at") : null
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** The role record, or null when there is none (no session has taken the role here). */
export function readRole(root: string): Role | null {
  const file = roleFile(root)
  if (!file || !existsSync(file)) return null
  try {
    const v: unknown = JSON.parse(readFileSync(file, "utf8"))
    if (!isObject(v) || (v["holder"] !== null && typeof v["holder"] !== "string") || typeof v["since"] !== "string") return null
    const retired = Array.isArray(v["retired"])
      ? v["retired"].filter((r): r is Retired => isObject(r) && typeof r["session"] === "string" && typeof r["at"] === "string")
      : []
    const p = v["pending"]
    const pending = isObject(p) && typeof p["from"] === "string" && typeof p["at"] === "string" && typeof p["note"] === "string"
      ? { from: p["from"], at: p["at"], note: p["note"] }
      : undefined
    return { holder: v["holder"], since: v["since"], retired, ...(pending ? { pending } : {}) }
  } catch {
    return null
  }
}

function writeRole(root: string, role: Role): void {
  const file = roleFile(root)
  if (!file) throw new NaimaError("the coordinator role is kept in a git project's state folder: this is not one")
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileAtomic(file, JSON.stringify(role, null, 2) + "\n")
}

/** Leave the limit for the turn-end script, or remove it when no coordinator holds the role. */
function setLimit(root: string, tokens: number | null): void {
  const file = limitFile(root)
  if (!file) return
  try {
    if (tokens === null) rmSync(file, { force: true })
    else {
      mkdirSync(join(file, ".."), { recursive: true })
      writeFileAtomic(file, `${tokens}\n`)
    }
  } catch {
    // the state folder cannot be written here: the turn-end script then has no limit, and does nothing
  }
}

/** Whether `root` is the main checkout, not a linked worktree: only a session there is a coordinator. */
export function inMainCheckout(root: string): boolean {
  const dirs = gitDirsOf(root)
  return !!dirs && dirs.own === dirs.common
}

/**
 * Take the coordinator role for `session`. Done by `naima hello` in the main checkout. It takes it from nobody (the
 * first session, or a handover made), and from a holder that is another session: a new session at the main checkout
 * is the coordinator the owner now talks to, so the earlier holder is retired as if it had handed over.
 */
export function takeRole(ctx: Context, session: string, options: HandoverOptions): { took: boolean; from?: string; note?: string } {
  const role = readRole(ctx.root)
  const now = ctx.now().toISOString()
  if (role?.holder === session) {
    setLimit(ctx.root, limitOf(options))
    return { took: false }
  }
  const retired = [...(role?.retired ?? [])]
  const from = role?.holder ?? role?.pending?.from
  if (role?.holder && !retired.some((r) => r.session === role.holder)) retired.push({ session: role.holder, at: now })
  writeRole(ctx.root, { holder: session, since: now, retired: retired.slice(-20) })
  setLimit(ctx.root, limitOf(options))
  return { took: true, ...(from ? { from } : {}), ...(role?.pending ? { note: role.pending.note } : {}) }
}

/** The single-writer guard: a session that gave the coordinator role up must not do the writer's work. Sessions the record does not know pass. */
export function requireWriter(ctx: Context, what: string): void {
  const session = currentSession(ctx.root)
  if (!session) return
  const role = readRole(ctx.root)
  if (!role || role.holder === session) return
  const retired = role.retired.find((r) => r.session === session)
  if (!retired) return
  throw new NaimaError(
    `${what}: refused. This session handed the coordinator role over at ${retired.at}, and the coordinator is the single writer: ` +
      `only the session that holds the role lands, pushes the trunk, publishes or releases. ` +
      `${role.holder ? "The successor does it" : "The successor, once its naima hello has taken the role, does it"}; end this session.`,
    "handed-over",
  )
}

// ── what is in flight ────────────────────────────────────────────────────────

/** What the session note records: every claim, the branches waiting to land, and what the plugins report for the coordinator (the runs, the open meeting). */
export function inFlight(ctx: Context, claims: ClaimsData): string[] {
  const out: string[] = []
  const main = trunk(ctx.trackerGit)
  const live = claims.claims.filter((c) => !c.stale)
  if (!live.length) out.push("Claims: none.")
  for (const c of live) {
    const items = c.items.map((e) => `${e.ref ?? e.id}${e.status ? ` (${e.status})` : ""}${e.done ? " done" : ""}`).join(", ") || "no items"
    const waiting = main ? aheadBehind(ctx.root, main, c.branch).ahead : 0
    out.push(
      `Claim ${c.branch}: ${items}${c.step ? `; now: ${c.step.what}` : ""}${c.silent ? "; silent, possibly stuck" : ""}` +
        `${waiting ? `; ${waiting} commit${waiting === 1 ? "" : "s"} not on ${main}: waiting to land` : ""}.`,
    )
  }
  for (const c of claims.claims.filter((c) => c.stale)) out.push(`Stale claim ${c.branch}: ${c.stale}.`)
  for (const r of claimsReports(ctx)) {
    out.push(`${r.name}:`)
    for (const l of r.lines) out.push(`  ${l}`)
  }
  return out
}

/** What starts the successor, as the old coordinator prints it: exact text to give a new session in the main checkout. */
export function successorText(noteFile: string): string[] {
  return [
    "To start the successor, open a new session in this project's main checkout (not a worktree) and give it this first message:",
    "",
    `> You are the coordinator's successor. Run naima hello: it takes the coordinator role from the session that handed over. ` +
    `Then resume from its session note (${noteFile}, or naima pass --list 1) and from naima claims, which list what was in flight. Continue that work; ` +
    `do not start anything the note does not name before reading it.`,
    "",
    "This session has given the role up: it must not land, push, publish or release any more. End it once the successor has started.",
  ]
}

// ── the commands ─────────────────────────────────────────────────────────────

/** What the commands need of the plugin around them, passed in so that this file does not import the plugin's own. */
export interface HandoverDeps {
  options: HandoverOptions
  claimsData(ctx: Context): ClaimsData
  writeNote(ctx: Context, text: string, ack: string | undefined): string
}

/** The host's adapter named with --hook, or the one the environment shows. */
function hostOf(id: string | undefined): AgentAdapter | undefined {
  return id ? adapter(id) : adapter("claude-code")
}

/** Standard input as a hook gives it: nothing from a terminal, or when it cannot be read. */
function stdin(): string {
  try {
    return process.stdin.isTTY ? "" : readFileSync(0, "utf8")
  } catch {
    return ""
  }
}

/** What the coordinator is told when its context is past the threshold: the text of the message. */
export const handoverMessage = (d: Depth): string =>
  `Your context is ${d.tokens} tokens, ${percent(d.share)} of the ${d.window}-token window, past the ${d.limit}-token limit for handing over. ` +
  `Hand over now: run naima handover, which writes the session note, gives the coordinator role up and prints what starts your successor. ` +
  `Start nothing new first; after it, do not land, push or publish.`

/**
 * What the turn end should say, or null: the coordinator past the threshold. Nothing when the session is not the holder
 * of the role (a worker, or a session that already handed over), when the role has no record, or when no measure exists.
 */
export function watch(ctx: Context, session: string | undefined, tokens: number | undefined, options: HandoverOptions): { depth: Depth; text: string } | null {
  const role = readRole(ctx.root)
  if (!session || !role || role.holder !== session) return null
  const depth = depthOf(tokens, options)
  if (!depth || !depth.past) return null
  return { depth, text: handoverMessage(depth) }
}

export const handoverCommand = (deps: HandoverDeps): Command => ({
  name: "handover",
  says:
    "hand the coordinator role over to a fresh session: write the session note with what is in flight, give the role up, print what starts the successor; --status says how deep the context is, --watch is what the turn end runs",
  enforces:
    "only the session that holds the coordinator role hands over (naima hello in the main checkout takes it); the handover writes the session note first, with every claim, the branches waiting to land, the runs and the open meeting, and gives the role up only once it is written; the session that gave it up is refused by land and by the push check, whatever it is told, and a worker's session is not affected",
  usage:
    'handover [--ack "<line>"] [--note "<what else is in hand>"] | handover --status | handover --watch [--hook <tool>] [--tokens <n>] [--session <id>] | handover --check [<what>] | handover --take',
  options: [
    { name: "--ack", says: "the acknowledgement line the project's rules ask a session note to carry, as naima pass --ack" },
    { name: "--note", says: "more for the successor, written in the session note after what is in flight: what the open conversation stands on" },
    { name: "--status", says: "say who holds the role, how deep the context is and the limit, or that the host gives no measure" },
    {
      name: "--watch",
      says:
        "what the turn-end hook runs: when this session holds the role and its context is past the limit, print the message that tells it to hand over (as the tool's turn-end decision with --hook, as a NAIMA-MESSAGE line otherwise); nothing in every other case",
    },
    { name: "--hook", says: "with --watch: the tool whose hook runs it, read from standard input", default: "claude-code" },
    { name: "--tokens", says: "with --watch: the context size, instead of the one the hook input gives" },
    { name: "--session", says: "with --watch: the session, instead of the hook input's or the current one" },
    { name: "--check", says: "exit 1 when this session gave the role up: for a script that publishes, as scripts/publish-site.sh does" },
    { name: "--take", says: "take the role for the current session, as naima hello does in the main checkout" },
  ],
  examples: [
    'handover --ack "Acknowledge: Quiet mode on"',
    "handover --status",
    "handover --watch --hook claude-code",
    "handover --check publishing the site",
  ],
  long: { reports: "nothing: it is a short command" },
  run(args, ctx) {
    const p = parse(args, {
      ack: { type: "string" },
      note: { type: "string" },
      status: { type: "boolean" },
      watch: { type: "boolean" },
      hook: { type: "string" },
      tokens: { type: "string" },
      session: { type: "string" },
      check: { type: "boolean" },
      take: { type: "boolean" },
    })
    const modes = ["status", "watch", "check", "take"].filter((m) => bool(p, m))
    if (modes.length > 1) throw usageError(this)
    const o = deps.options
    if (bool(p, "check")) {
      requireWriter(ctx, p.positionals.join(" ") || "this")
      return 0
    }
    if (p.positionals.length) throw usageError(this)
    if (bool(p, "watch")) {
      const host = hostOf(str(p, "hook"))
      const input = str(p, "tokens") === undefined ? stdin() : ""
      const given = str(p, "tokens")
      if (given !== undefined && !/^\d+$/.test(given)) throw new NaimaError(`--tokens takes a whole number, got ${JSON.stringify(given)}`)
      const tokens = given !== undefined ? Number(given) : host?.contextTokens?.(input)
      const session = str(p, "session") ?? (input ? host?.sessionOf?.(input) : undefined) ?? currentSession(ctx.root)
      const w = watch(ctx, session, tokens, o)
      if (!w) return 0
      if (str(p, "hook") !== undefined && host?.stopFor) ctx.out(host.stopFor(w.text))
      else ctx.err(messageLine({ id: "coordinator-handover-due", level: "urgent", text: w.text }))
      return 0
    }
    const session = currentSession(ctx.root)
    if (bool(p, "take")) {
      if (!session) throw new NaimaError("no session here: naima hello starts one")
      const r = takeRole(ctx, session, o)
      ctx.out(
        r.took
          ? `session ${session} now holds the coordinator role${r.from ? ` (from ${r.from})` : ""}`
          : `session ${session} holds the coordinator role already`,
      )
      return 0
    }
    const role = readRole(ctx.root)
    if (bool(p, "status")) {
      ctx.out(
        role
          ? `coordinator: ${role.holder ?? "nobody (handed over, the successor has not taken the role)"}, since ${role.since}${
            session && role.holder === session ? " (this session)" : ""
          }`
          : "coordinator: no record yet (naima hello in the main checkout takes the role)",
      )
      for (const r of role?.retired.slice(-3) ?? []) ctx.out(`handed over: ${r.session} at ${r.at}`)
      ctx.out(`limit: ${limitOf(o)} tokens, ${percent(o.handoverAt)} of a ${o.contextWindow}-token window (coordination options contextWindow, handoverAt)`)
      const measured = ADAPTER_MEASURES()
      ctx.out(
        measured.length
          ? `context measure: ${measured.join(", ")}`
          : "context measure: none: no host Naima knows gives one, so nothing is measured and nothing is guessed",
      )
      return 0
    }
    // The handover itself.
    if (!session) throw new NaimaError("no session here: naima hello starts one, and only the session that holds the coordinator role hands over")
    if (!role || role.holder !== session) {
      throw new NaimaError(
        role?.retired.some((r) => r.session === session)
          ? "this session handed the role over already: the successor continues"
          : `this session does not hold the coordinator role${
            role?.holder ? ` (${role.holder} does)` : ""
          }: naima handover --status says who does; the role is taken by naima hello in the main checkout`,
        "handed-over",
      )
    }
    const claims = deps.claimsData(ctx)
    const lines = inFlight(ctx, claims)
    const more = str(p, "note")?.trim()
    const text = [
      `Handover of the coordinator role, from session ${session} to its successor.`,
      "",
      "In flight when it gave the role up:",
      ...lines.map((l) => `- ${l}`),
      ...(more ? ["", more] : []),
      "",
      "The successor runs naima hello, which takes the role, and resumes from here.",
    ].join("\n")
    // The note first: the role passes only once everything claimed is in it.
    const note = deps.writeNote(ctx, text, str(p, "ack"))
    writeRole(ctx.root, {
      holder: null,
      since: ctx.now().toISOString(),
      retired: [...role.retired, { session, at: ctx.now().toISOString() }].slice(-20),
      pending: { from: session, at: ctx.now().toISOString(), note },
    })
    setLimit(ctx.root, null)
    ctx.out(`wrote ${note}: the session note with what is in flight (${lines.length} line${lines.length === 1 ? "" : "s"})`)
    ctx.out(`session ${session} gave the coordinator role up`)
    for (const l of successorText(note)) ctx.out(l)
    return 0
  },
})

/** The hosts Naima knows that give a context measure, by name. */
const ADAPTER_MEASURES = (): string[] => ["claude-code"].map((id) => adapter(id)).filter((a): a is AgentAdapter => !!a?.contextTokens).map((a) => a.name)

/** The summary section that takes the coordinator role at `naima hello`, in the main checkout, and says it when it came from a handover. */
export const handoverSection = (options: HandoverOptions): SummarySection => ({
  name: "handover",
  render: () => rendered({}, () => []),
  atStart(ctx) {
    const session = currentSession(ctx.root)
    if (!session || !inMainCheckout(ctx.root) || !roleFile(ctx.root)) return { said: [], needs: [] }
    const r = takeRole(ctx, session, options)
    if (!r.took) return { said: [], needs: [] }
    if (!r.from) return { said: [`took the coordinator role (session ${session})`], needs: [] }
    return {
      said: [`took the coordinator role from session ${r.from}`],
      needs: r.note
        ? [`The previous coordinator handed over: read its session note ${r.note} (naima pass --list 1) and naima claims, then resume what was in flight.`]
        : [],
    }
  },
})
