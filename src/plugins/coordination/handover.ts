// The coordinator's handover to a fresh session: a coordinator session degrades
// as its context fills, so it measures how large the context is and, past a
// threshold, suggests a handover to the owner, in its next reply, after answering
// what the owner asked. On the owner's yes it finalizes the pending work (lands or
// hands off what is in flight, goes through the conversation it holds and records
// every request and decision of the owner, nothing here guesses what counts as
// one), then records where its transcript is kept, writes the session note, gives
// the coordinator role up and prints what starts its successor. On a no it carries
// on and suggests it again later (features/coordinator-hands-over-fresh-session-when-context).
//
// The role is a record in the clone's state folder, shared by its worktrees and
// never committed:
//
//   <git common dir>/naima/coordinator.json   { holder, since, retired: [{ session, at }], pending?, handing?, predecessor? }
//   <git common dir>/naima/handover/<session>.jsonl   a copy of the handing-over session's transcript, for its successor
//
// `naima hello` in the main checkout takes the role for its session. A handover
// makes the holder nobody and lists the old session as retired; the successor's
// hello takes it. A retired session is refused by `requireWriter`, which `land`
// and the push check call: the single writer's work is never done by a session
// that gave the role up. The behaviour is modelled first: develop/models/handover/.
//
// The transcript's copy stays in that state folder: it is the owner's whole conversation, so it is never committed and
// no tracker text names its path. The successor's hello points to it and `naima handover --read` prints excerpts.
//
// The measure is the host's: the hook input carries the transcript, whose last
// assistant message's usage is the context size and whose model id names the
// window (core/adapters, windows.ts). A host without one has no measure, and
// nothing here guesses it; a window nobody set and nobody published is assumed,
// and every text that uses it says so, stating no share of it.
//
// A context notice never outranks the project's rules: recording in the tracker
// and Naima's complete, correct operation come first, and no notice asks an
// agent to skip, shorten or hurry anything. The session that holds the role is
// told about handing over; any other session (a worker, a side session) is told
// about its own bound (workerAt): past it, it finishes its step in full, writes
// its state into its items' notes, marks its claim (naima claim --at-bound) and
// ends, and the coordinator continues with a fresh worker. The worker's bound
// is modelled first: develop/models/worker-bound/.

import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  adapter,
  ADAPTERS,
  type AgentAdapter,
  bool,
  type Command,
  type Context,
  type ConversationMessage,
  conversationOf,
  currentSession,
  gitDirsOf,
  locateSessionTranscript,
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
import { publishedModels, readWindows, windowOf, type WindowOptions, type WindowSource } from "./windows.ts"

// ── the options ──────────────────────────────────────────────────────────────

export { DEFAULT_WINDOW } from "./windows.ts"
/** The share of the window past which the coordinator starts handing over, when the project names none: the owner's choice, the usual one. */
export const DEFAULT_HANDOVER_AT = 0.6
/** The share of its own model's window past which a worker ends and a fresh one continues its work, when the project names none: the owner's choice, as handoverAt is. */
export const DEFAULT_WORKER_AT = 0.6
/** After the owner postpones, the coordinator is reminded once its context has grown by this share of the window. */
export const REMIND_SHARE = 0.05

export interface HandoverOptions extends WindowOptions {
  /** The share of the window past which the coordinator hands over, above 0 and at most 1. */
  handoverAt: number
  /** The share of its own model's window past which a worker ends, above 0 and at most 1. */
  workerAt: number
}

const share = (o: Record<string, unknown>, name: string, fallback: number): number => {
  const at = o[name] ?? fallback
  if (typeof at !== "number" || !(at > 0) || at > 1) {
    throw new Error(`coordination: options.${name} is not a share of the window above 0 and at most 1, got ${JSON.stringify(at)}`)
  }
  return at
}

/** The options as the project gives them, validated: a malformed one fails loading, naming it. */
export function readHandoverOptions(o: Record<string, unknown>): HandoverOptions {
  const window = o["contextWindow"]
  if (window !== undefined && (typeof window !== "number" || !Number.isInteger(window) || window < 1)) {
    throw new Error(`coordination: options.contextWindow is not a positive whole number of tokens, got ${JSON.stringify(window)}`)
  }
  return {
    contextWindows: readWindows(o["contextWindows"]),
    ...(window !== undefined ? { contextWindow: window as number } : {}),
    handoverAt: share(o, "handoverAt", DEFAULT_HANDOVER_AT),
    workerAt: share(o, "workerAt", DEFAULT_WORKER_AT),
  }
}

/** The depth of the context against a bound: the coordinator's handover point, or a worker's bound. */
export interface Depth {
  tokens: number
  /** The window, and whether it is set by the project, published for the model, or the default assumed. */
  window: number
  source: WindowSource
  model?: string
  /** The share of the window the context fills: a fact only when the window is not assumed. */
  share: number
  /** The tokens past which the bound is passed. */
  limit: number
  past: boolean
}

/** The limit in tokens: the window of `model` times the share, rounded down. */
export const limitOf = (o: HandoverOptions, model?: string, at: number = o.handoverAt): number => Math.floor(windowOf(model, o).tokens * at)

/** How deep the context is, against the bound `at`. Undefined with no measure: the host gives none, and a number is never guessed. */
export function depthOf(tokens: number | undefined, o: HandoverOptions, model?: string, at: number = o.handoverAt): Depth | undefined {
  if (tokens === undefined || !Number.isFinite(tokens) || tokens < 0) return undefined
  const w = windowOf(model, o)
  const limit = Math.floor(w.tokens * at)
  return { tokens, window: w.tokens, source: w.source, ...(w.model ? { model: w.model } : {}), share: tokens / w.tokens, limit, past: tokens >= limit }
}

const percent = (share: number): string => `${Math.round(share * 100)}%`

// ── the role record ──────────────────────────────────────────────────────────

/** A session that gave the role up. */
export interface Retired {
  session: string
  at: string
}

/**
 * Where the old coordinator is in handing over, once past the threshold (or asked to), the states of the model after
 * reach_threshold: due to suggest it in its next reply, proposed to the owner, agreed by the owner (finalizing), postponed.
 */
export type Phase = "due" | "proposed" | "agreed" | "postponed"
const PHASES: readonly string[] = ["due", "proposed", "agreed", "postponed"]
/** A record written before the owner-first order: its phases before the proposal are a suggestion still due. */
const OLD_PHASES: Readonly<Record<string, Phase>> = { finishing: "due", checking: "due" }

export interface Handing {
  phase: Phase
  since: string
  /** The transcript file the host named, as the turn-end hook was given it. */
  transcript?: string
  /** The context size when it was last seen: a postponement reminds again once it has grown. */
  tokens?: number
  /** The window it was measured against, and the share it filled when that window is set or published (never of an assumed one). */
  window?: number
  share?: number
  /**
   * The review of the owner's requests the coordinator recorded, signed against the no-leaks checklist: each request since the
   * last session note with where it is recorded. Current only when recorded after the owner's last message.
   */
  reviewed?: Review
  /** When the handover was proposed to the owner: what the owner says after it is the reply. */
  proposedAt?: string
  /** When the owner said yes: the finalizing began. */
  agreedAt?: string
}

/** The coordinator's review of the owner's requests. */
export interface Review {
  at: string
  list: string
}

export interface Role {
  /** The session that is the coordinator; null between a handover and the successor taking the role. */
  holder: string | null
  since: string
  retired: Retired[]
  /** A handover made and not yet taken: who gave the role up, when, and the session note it wrote. */
  pending?: { from: string; at: string; note: string; transcript?: string }
  /** Set on the old coordinator past the threshold, until it hands over. */
  handing?: Handing
  /** On the successor: the session it took the role from, its note and the private copy of its transcript. */
  predecessor?: { session: string; at: string; note: string; transcript?: string }
}

/** The role record's file; null outside git. */
const roleFile = (root: string): string | null => {
  const dir = stateDir(root)
  return dir ? join(dir, "coordinator.json") : null
}

/**
 * The limits the turn-end script compares the context with, left in the tick's folder, so it needs no Deno; present only
 * while a coordinator holds the role. `handover-at` holds the limit for a model with no line of its own, and
 * `handover-at-models` one line per model id, `<model> <tokens>`: each the lower of the coordinator's handover point and a
 * worker's bound, since the script does not know which the session is, and naima handover --watch then decides.
 */
const limitFile = (root: string): string | null => {
  const dir = stateDir(root)
  return dir ? join(dir, "tick", "handover-at") : null
}
const modelLimitsFile = (root: string): string | null => {
  const dir = stateDir(root)
  return dir ? join(dir, "tick", "handover-at-models") : null
}

/** The lower of the two bounds for `model`: what the turn-end script compares with. */
const scriptLimit = (o: HandoverOptions, model?: string): number => Math.min(limitOf(o, model, o.handoverAt), limitOf(o, model, o.workerAt))

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
      ? { from: p["from"], at: p["at"], note: p["note"], ...(typeof p["transcript"] === "string" ? { transcript: p["transcript"] } : {}) }
      : undefined
    const h = v["handing"]
    const phase = isObject(h) ? (PHASES.includes(String(h["phase"])) ? h["phase"] as Phase : OLD_PHASES[String(h["phase"])]) : undefined
    const handing: Handing | undefined = isObject(h) && phase && typeof h["since"] === "string"
      ? {
        phase,
        since: h["since"],
        ...(typeof h["transcript"] === "string" ? { transcript: h["transcript"] } : {}),
        ...(typeof h["tokens"] === "number" ? { tokens: h["tokens"] } : {}),
        ...(typeof h["window"] === "number" ? { window: h["window"] } : {}),
        ...(typeof h["share"] === "number" ? { share: h["share"] } : {}),
        ...(isObject(h["reviewed"]) && typeof h["reviewed"]["at"] === "string" && typeof h["reviewed"]["list"] === "string"
          ? { reviewed: { at: h["reviewed"]["at"], list: h["reviewed"]["list"] } }
          : {}),
        ...(typeof h["proposedAt"] === "string" ? { proposedAt: h["proposedAt"] } : {}),
        ...(typeof h["agreedAt"] === "string" ? { agreedAt: h["agreedAt"] } : {}),
      }
      : undefined
    const d = v["predecessor"]
    const predecessor = isObject(d) && typeof d["session"] === "string" && typeof d["at"] === "string" && typeof d["note"] === "string"
      ? { session: d["session"], at: d["at"], note: d["note"], ...(typeof d["transcript"] === "string" ? { transcript: d["transcript"] } : {}) }
      : undefined
    return {
      holder: v["holder"],
      since: v["since"],
      retired,
      ...(pending ? { pending } : {}),
      ...(handing ? { handing } : {}),
      ...(predecessor ? { predecessor } : {}),
    }
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

/** Leave the limits for the turn-end script, or remove them when no coordinator holds the role. */
function setLimit(root: string, o: HandoverOptions | null): void {
  const file = limitFile(root)
  const models = modelLimitsFile(root)
  if (!file || !models) return
  try {
    if (o === null) {
      rmSync(file, { force: true })
      rmSync(models, { force: true })
    } else {
      mkdirSync(join(file, ".."), { recursive: true })
      writeFileAtomic(file, `${scriptLimit(o)}\n`)
      const ids = [...new Set([...publishedModels(), ...Object.keys(o.contextWindows)])].filter((m) => /^[A-Za-z0-9._:@\[\]\/-]+$/.test(m)).sort()
      writeFileAtomic(models, ids.map((m) => `${m} ${scriptLimit(o, m)}\n`).join(""))
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
export function takeRole(
  ctx: Context,
  session: string,
  options: HandoverOptions,
): { took: boolean; from?: string; note?: string; transcript?: string } {
  const role = readRole(ctx.root)
  const now = ctx.now().toISOString()
  if (role?.holder === session) {
    setLimit(ctx.root, options)
    return { took: false }
  }
  const retired = [...(role?.retired ?? [])]
  const from = role?.holder ?? role?.pending?.from
  if (role?.holder && !retired.some((r) => r.session === role.holder)) retired.push({ session: role.holder, at: now })
  const pending = role?.pending
  writeRole(ctx.root, {
    holder: session,
    since: now,
    retired: retired.slice(-20),
    ...(pending
      ? { predecessor: { session: pending.from, at: pending.at, note: pending.note, ...(pending.transcript ? { transcript: pending.transcript } : {}) } }
      : {}),
  })
  setLimit(ctx.root, options)
  return {
    took: true,
    ...(from ? { from } : {}),
    ...(pending ? { note: pending.note } : {}),
    ...(pending?.transcript ? { transcript: pending.transcript } : {}),
  }
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
      `Claim ${c.branch}: ${items}${c.step ? `; now: ${c.step.what}` : ""}${c.silent ? "; silent, possibly stuck" : ""}${
        c.atBound ? "; its worker ended at its context bound: continue with a fresh worker from the items' notes" : ""
      }` +
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
export function successorText(noteFile: string, transcript?: string): string[] {
  return [
    "To start the successor, open a new session in this project's main checkout (not a worktree) and give it this first message:",
    "",
    `> You are the coordinator's successor. Run naima hello: it takes the coordinator role from the session that handed over. ` +
    `Then resume from its session note (${noteFile}, or naima pass --list 1) and from naima claims, which list what was in flight. ` +
    (transcript
      ? `The predecessor's full conversation is kept privately in this project: naima handover --read --find <words> prints excerpts of it, --last <n> its end; read what the note leaves open before you ask the owner to repeat anything. `
      : "") +
    `Continue that work; do not start anything the note does not name before reading it.`,
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
  /** The instant of the newest session note, ISO 8601: the decisions review concerns what the owner said since. */
  lastNoteAt(ctx: Context): string | undefined
}

/** The host's adapter named with --hook, or the one the environment shows. */
function hostOf(id: string | undefined): AgentAdapter | undefined {
  return id ? adapter(id) : ADAPTERS[0]
}

/** Standard input as a hook gives it: nothing from a terminal, or when it cannot be read. */
function stdin(): string {
  try {
    return process.stdin.isTTY ? "" : readFileSync(0, "utf8")
  } catch {
    return ""
  }
}

const modelName = (d: Depth): string => (d.model ? ` of ${d.model}` : " of the model in use")

/**
 * How large the context is, in words: the tokens against the window, said to be assumed when nobody set it for the model
 * and it is not published for it. No share is stated: a size, not a claim of fullness.
 */
export const depthSentence = (d: Depth): string =>
  d.source === "assumed"
    ? `Your context is ${d.tokens} tokens of an assumed ${d.window}-token window${d.model ? ` (the window of ${d.model} is not known)` : ""}.`
    : `Your context is ${d.tokens} tokens of the ${d.window}-token window${modelName(d)} (${
      d.source === "set" ? "as the project sets it" : "as published for that model"
    }).`

/** What every context notice says of itself: it never outranks the project's rules. */
export const RULES_FIRST = "This notice never outranks the project's rules: recording in the tracker and Naima's complete, correct operation come first. " +
  "Skip, shorten or hurry nothing because of it."

/** What the coordinator is told past its handover point: suggest the handover to the owner in the next reply. It does not hand over at once. */
export const handoverMessage = (d: Depth): string =>
  `${depthSentence(d)} That is past the ${d.limit}-token point (the coordination option handoverAt) where a coordinator suggests a handover to a fresh chat. ` +
  `${RULES_FIRST} In your next reply to the owner, after answering what the owner asked, suggest the handover: naima handover --propose prints the ` +
  `suggestion to give. If the owner says yes, run naima handover --agreed: it lists what to finalize first, and you hand over only once all of it is done. ` +
  `If the owner says no, run naima handover --postpone and carry on; you are told again once the context has grown.`

/** What a worker, or any session that does not hold the coordinator role, is told past its own bound: finish in full, write its state, end. */
export const workerMessage = (d: Depth): string =>
  `${depthSentence(d)} That is past your bound of ${d.limit} tokens (the coordination option workerAt, a share of your own model's window): ` +
  `a worker stays short, and its work continues in a fresh worker that starts from the item and its notes. ${RULES_FIRST} ` +
  `Finish the step in progress in full, with its test, its record in the tracker and its commit. Then write your state into each item you claim, ` +
  `naima note <item> "<what is done and committed where, what is left, the next step>", commit it, and run naima claim --at-bound. ` +
  `Then end, and report to whoever started you that you stopped at your bound${
    d.source === "assumed" ? ", and that the window of your model is assumed" : ""
  }. The coordinator continues the item with a fresh worker; you are not the coordinator, and nothing here is about handing its role over.`

/** Whom a context notice addresses: the session that holds the coordinator role, or any other. */
export type Addressed = "coordinator" | "worker"

/** The file that says a session was told of its bound: it is told once. */
const boundMark = (root: string, session: string): string | null => {
  const dir = stateDir(root)
  return dir && /^[A-Za-z0-9._-]+$/.test(session) ? join(dir, "bound", session) : null
}

/**
 * What the turn end should say, or null. The session that holds the role, past its handover point, the first time (and
 * again once a postponement has been outgrown): it starts the handing over, which records the transcript the host names.
 * Any other session the role record does not list as retired (a worker, a side session), past its own bound, once: it is
 * told to finish in full and end. Nothing when the role has no record, when no measure exists, or while the handing over
 * is in hand: a notice is said once, not every turn.
 */
export function watch(
  ctx: Context,
  session: string | undefined,
  tokens: number | undefined,
  options: HandoverOptions,
  transcript?: string,
  model?: string,
): { depth: Depth; text: string; to: Addressed } | null {
  const role = readRole(ctx.root)
  if (!session || !role) return null
  if (role.holder !== session) {
    if (role.retired.some((r) => r.session === session) || role.pending?.from === session) return null
    const depth = depthOf(tokens, options, model, options.workerAt)
    if (!depth || !depth.past) return null
    const mark = boundMark(ctx.root, session)
    if (!mark || existsSync(mark)) return null
    mkdirSync(join(mark, ".."), { recursive: true })
    writeFileAtomic(mark, `${ctx.now().toISOString()} ${depth.tokens}\n`)
    return { depth, text: workerMessage(depth), to: "worker" }
  }
  const depth = depthOf(tokens, options, model)
  if (!depth || !depth.past) return null
  const h = role.handing
  const now = ctx.now().toISOString()
  if (h && h.phase !== "postponed") {
    if (!h.transcript && transcript) writeRole(ctx.root, { ...role, handing: { ...h, transcript } })
    return null
  }
  if (h && depth.tokens < (h.tokens ?? 0) + Math.floor((h.window ?? depth.window) * REMIND_SHARE)) return null
  const next: Handing = {
    phase: "due",
    since: now,
    tokens: depth.tokens,
    window: depth.window,
    ...(depth.source !== "assumed" ? { share: depth.share } : {}),
    ...(h?.reviewed ? { reviewed: h.reviewed } : {}),
    ...((transcript ?? h?.transcript) ? { transcript: (transcript ?? h?.transcript)! } : {}),
  }
  writeRole(ctx.root, { ...role, handing: next })
  return { depth, text: handoverMessage(depth), to: "coordinator" }
}

const cut = (text: string, width: number): string => (text.length > width ? `${text.slice(0, width - 1)}…` : text)

/** The transcript of `session` as text, and where it was read from: the one the host named, else the one the tool keeps for the session. */
function transcriptOf(role: Role, session: string): { file: string; text: string } | undefined {
  const named = role.handing?.transcript
  const file = named && existsSync(named) ? named : locateSessionTranscript(process.env, session)
  if (!file) return undefined
  try {
    return { file, text: readFileSync(file, "utf8") }
  } catch {
    return undefined
  }
}

/** What the owner said in this session since the last session note, as far as the transcript shows. */
interface Said {
  since: string
  /** The instants of the owner's messages since then; empty when the transcript gives none. */
  times: string[]
}

/** The no-leaks checklist this Naima ships, which a review is signed against (the same file as the privacy plugin's). */
const CHECKLIST = fileURLToPath(new URL("../../../docs/agents/NOLEAKS.md", import.meta.url))

const hashOf = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

/**
 * When the owner spoke, since the last session note. Without a transcript to read the time of the owner's last message is
 * unknown, and the commands refuse, unless `blind` says the coordinator judged by hand.
 */
function ownerSaid(ctx: Context, deps: HandoverDeps, role: Role, session: string, blind: boolean): Said {
  const since = deps.lastNoteAt(ctx) ?? role.since
  const t = transcriptOf(role, session)
  if (!t) {
    if (blind) return { since, times: [] }
    throw new NaimaError(
      "this session's transcript cannot be read (the host gives none, or it is not where the host says), so when the owner last spoke is unknown: " +
        "go through the owner's requests since the last session note by hand, then repeat the command with --no-transcript",
    )
  }
  const times = conversationOf(t.text)
    .filter((m) => m.who === "owner" && m.at !== undefined && m.at >= since)
    .map((m) => m.at!)
    .sort()
  return { since, times }
}

/** Is the recorded review made after the owner's last message? */
function reviewCurrent(role: Role, said: Said): boolean {
  const r = role.handing?.reviewed
  return !!r && !said.times.some((t) => t > r.at)
}

/** What the coordinator is asked to do: the review itself, which only it, holding the conversation, can make. */
function reviewTask(since: string, said: Said): string[] {
  return [
    `decisions review: go through every request and decision the owner made since the last session note (${since}), in the conversation you hold` +
    `${said.times.length ? ` (the transcript shows ${said.times.length} owner message${said.times.length === 1 ? "" : "s"} since)` : ""}.`,
    'For each, write one line: what the owner asked or decided, and where it was recorded (the item, decision, diary entry or note), or "missing".',
    'File what is missing (naima new, naima event <today> "<what, why>" --kind diary, a decision record), then record the review, every line naming where it is recorded:',
    '  naima handover --decisions --reviewed "<the list>" --revised <the no-leaks checklist>      (or --reviewed-file <file>)',
    "Nothing is judged for you: a review is the only way past this step, and the proposal waits for one made after the owner's last message.",
  ]
}

/** A review's text: refused when it is empty or still lists a request as missing. */
function checkedReview(text: string): string {
  const list = text.trim()
  if (!list) {
    throw new NaimaError(
      "the review is empty: list each request the owner made since the last session note with where it is recorded (or write `none` and why)",
    )
  }
  const missing = list.split("\n").filter((l) => /\bmissing\s*[.)\]]?\s*$/i.test(l.trim()))
  if (missing.length) {
    throw new NaimaError(
      `the review still lists ${missing.length} request${missing.length === 1 ? "" : "s"} as missing: file ${
        missing.length === 1 ? "it" : "them"
      } first (naima new, ` +
        `naima event --kind diary, a decision record), then write where ${missing.length === 1 ? "it is" : "each is"} recorded: ${
          cut(missing[0]!.trim(), 120)
        }`,
    )
  }
  return list
}

/** The review is signed: --revised names the no-leaks checklist this Naima ships, which the writer read, since the list may hold private text. */
function requireSigned(ctx: Context): void {
  const how = "read docs/agents/NOLEAKS.md of the program, check the review against it, and run the command again with --revised <its path>"
  if (ctx.revised === undefined) throw new NaimaError(`the review is not recorded: it is free text, signed against the no-leaks checklist — ${how}`)
  let given: Uint8Array
  try {
    given = readFileSync(ctx.revised)
  } catch {
    throw new NaimaError(`the review is not recorded: --revised names ${ctx.revised}, which cannot be read — ${how}`)
  }
  if (hashOf(given) !== hashOf(readFileSync(CHECKLIST))) {
    throw new NaimaError(`the review is not recorded: --revised names a file that is not the no-leaks checklist this Naima ships — ${how}`)
  }
}

/** The suggestion the owner is given in the coordinator's next reply: what a handover does, and the owner's choice. */
function proposalText(lines: number, size: string | undefined): string[] {
  return [
    "Give the owner this suggestion in your reply, after answering what the owner asked, and go on with the conversation. If the owner says yes, run naima handover --agreed; if no, naima handover --postpone.",
    "",
    `> ${size ? `This conversation has reached ${size}. ` : ""}A fresh chat keeps me sharp, so I suggest we continue in a new one. ` +
    `If you agree, I first finish what is pending: I make sure each of your requests and decisions of this session is recorded in the tracker, ` +
    `land or hand off the ${lines} piece${lines === 1 ? "" : "s"} of work in flight, and write a session note; the full text of this conversation is kept ` +
    `privately in the project, never committed. Then you open a new chat in the project's main checkout and paste the message I give you, and the new ` +
    `coordinator carries on where I stopped. Nothing is lost. Shall we, or do you want to go on for now?`,
  ]
}

/** What finalizing takes, after the owner's yes: the steps before the role passes. */
function finalizeText(): string[] {
  return [
    "The owner said yes: finalize the pending work, each step in full, then hand over. Skip, shorten or hurry nothing.",
    "1. Bring the work in flight to a stop: land what is ready (naima land), and for what is not, have its worker write its state into the item's notes and end (naima claim --at-bound), or hand it off as a queued item.",
    '2. Go through the conversation you hold: every request and decision of the owner since the last session note is filed (naima new, naima event --kind diary, a decision record), then record the review with naima handover --decisions --reviewed "<list>" --revised <the no-leaks checklist>.',
    "3. Hand over with naima handover --done: it keeps a private copy of this conversation, writes the session note with what is still in flight and gives the role up. It is refused until a review is recorded after the owner's last message.",
    "If the owner says more meanwhile, answer and record it, and review again; if the owner changes their mind, naima handover --postpone.",
  ]
}

/** The conversation's messages, as `naima handover --read` prints them. */
function excerpt(messages: ConversationMessage[], find: string | undefined, from: number | undefined, last: number, width: number): string[] {
  const hit = find
    ? messages.filter((m) => m.text.toLowerCase().includes(find.toLowerCase()))
    : from !== undefined
    ? messages.filter((m) => m.n >= from)
    : messages
  const shown = find || from === undefined ? hit.slice(-last) : hit.slice(0, last)
  return shown.map((m) => `#${m.n} ${m.at ?? ""} ${m.who}: ${cut(m.text.replace(/\s+/g, " ").trim(), width)}`)
}

const positive = (v: string | undefined, what: string, fallback: number): number => {
  if (v === undefined) return fallback
  if (!/^[1-9]\d*$/.test(v)) throw new NaimaError(`${what} takes a positive whole number, got ${JSON.stringify(v)}`)
  return Number(v)
}

export const handoverCommand = (deps: HandoverDeps): Command => ({
  name: "handover",
  says:
    "hand the coordinator role over to a fresh session, in steps the owner is part of: past the threshold the coordinator's next reply suggests it (--propose prints the suggestion); on the owner's yes (--agreed) it finalizes the pending work: lands or hands off what is in flight, and --decisions asks it to review every request and decision of the owner against the tracker and records the review (--reviewed); then --done keeps the conversation's text for the successor, writes the session note and gives the role up; --postpone on the owner's no; --read reads the predecessor's conversation; --status says how large the context is, --watch is what the turn end runs",
  enforces:
    "only the session that holds the coordinator role hands over (naima hello in the main checkout takes it); the suggestion comes first, and the finalizing only after the owner's yes (--agreed); the handover (--done) only after that yes and a signed review of the owner's requests recorded after the owner's last message, and once the transcript's private copy is made; the handover writes the session note first, with every claim, the branches waiting to land, the runs and the open meeting, and gives the role up only once it is written; the session that gave it up is refused by land and by the push check, whatever it is told, and a worker's session is not affected; no context notice states a share of a window nobody set or published, asks anyone to skip, shorten or hurry anything, or addresses a session that does not hold the role as the coordinator",
  usage:
    'handover --propose | handover --agreed | handover --postpone [--tokens <n>] | handover --decisions [--reviewed "<list>" | --reviewed-file <file>] [--no-transcript] | handover --done [--ack "<line>"] [--note "<what else is in hand>"] [--no-transcript] | handover --read [--find <words> | --from <n>] [--last <n>] [--width <n>] | handover --status | handover --watch [--hook <tool>] [--tokens <n>] [--session <id>] [--model <id>] | handover --check [<what>] | handover --take',
  options: [
    {
      name: "--decisions",
      says:
        'ask the coordinator, which holds the whole conversation, to go through every request and decision the owner made since the last session note, list each with where it was recorded or "missing", file what is missing and record the review with --reviewed; alone, it prints that task',
    },
    {
      name: "--reviewed",
      says:
        "with --decisions: the review, one line per request with where it is recorded (an item, decision, diary entry or note); refused when a line says missing, and unless signed: --revised <path of docs/agents/NOLEAKS.md> says the writer checked the text against the no-leaks checklist",
    },
    { name: "--reviewed-file", says: "with --decisions: the file that holds the review, instead of --reviewed" },
    {
      name: "--propose",
      says:
        "print the suggestion the coordinator gives the owner in its next reply, after answering what the owner asked: what a handover does, that the pending work is finished first and nothing is lost, and the owner's choice",
    },
    {
      name: "--agreed",
      says: "the owner said yes to the suggestion: record it and print what finalizing takes before the handover (--done)",
    },
    {
      name: "--postpone",
      says: "the owner said no, or not now: carry on, to be suggested again once the context has grown by 5% of the window",
    },
    {
      name: "--done",
      says:
        "after the owner's yes and a review recorded since the owner last spoke: keep a private copy of this session's transcript, write the session note with what is still in flight, give the role up and print the successor's start",
    },
    {
      name: "--no-transcript",
      says: "the host's transcript cannot be read: the check was done by hand, and the handover goes on without a copy of the conversation",
    },
    {
      name: "--read",
      says: "the successor reads its predecessor's conversation, from the private copy: the last messages, those containing --find, or those from --from",
    },
    { name: "--find", says: "with --read: only the messages containing these words, the last --last of them" },
    { name: "--from", says: "with --read: start at this message number" },
    { name: "--last", says: "with --read: how many messages", default: "20" },
    { name: "--width", says: "with --read: the characters of each message shown", default: "600" },
    { name: "--ack", says: "the acknowledgement line the project's rules ask a session note to carry, as naima pass --ack" },
    { name: "--note", says: "more for the successor, written in the session note after what is in flight: what the open conversation stands on" },
    { name: "--status", says: "say who holds the role, where it is in handing over, the windows and the shares, and whether the host gives a measure" },
    {
      name: "--watch",
      says:
        "what the turn-end hook runs: when this session holds the role and its context is past the handover point, the first time, print the message that tells it to suggest a handover to the owner in its next reply; when it is another session (a worker, a side session) past its own bound (workerAt), once, the message that tells it to finish its step in full, write its state into its items' notes and end (as the tool's turn-end decision with --hook, as a NAIMA-MESSAGE line otherwise); each states the context's size against the window, said to be assumed when nobody set it for the model and it is not published, and says the rules come first; nothing in every other case",
    },
    { name: "--hook", says: "with --watch: the tool whose hook runs it, read from standard input", default: "the first tool Naima knows" },
    { name: "--tokens", says: "with --watch: the context size, instead of the one the hook input gives; with --postpone: the size to remind from" },
    { name: "--session", says: "with --watch: the session, instead of the hook input's or the current one" },
    { name: "--model", says: "with --watch: the model id whose window the context is measured against, instead of the one the hook input's transcript names" },
    { name: "--check", says: "exit 1 when this session gave the role up: for a script that publishes, as scripts/publish-site.sh does" },
    { name: "--take", says: "take the role for the current session, as naima hello does in the main checkout" },
  ],
  examples: [
    "handover --propose",
    "handover --agreed",
    "handover --decisions",
    'handover --done --ack "Acknowledge: Quiet mode on"',
    'handover --read --find "threshold"',
    "handover --status",
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
      model: { type: "string" },
      check: { type: "boolean" },
      take: { type: "boolean" },
      decisions: { type: "boolean" },
      reviewed: { type: "string" },
      "reviewed-file": { type: "string" },
      propose: { type: "boolean" },
      postpone: { type: "boolean" },
      agreed: { type: "boolean" },
      done: { type: "boolean" },
      "no-transcript": { type: "boolean" },
      read: { type: "boolean" },
      find: { type: "string" },
      from: { type: "string" },
      last: { type: "string" },
      width: { type: "string" },
    })
    const decisions = bool(p, "decisions") || str(p, "reviewed") !== undefined || str(p, "reviewed-file") !== undefined
    const modes = [
      ...["status", "watch", "check", "take", "propose", "postpone", "agreed", "done", "read"].filter((m) => bool(p, m)),
      ...(decisions ? ["decisions"] : []),
    ]
    if (modes.length > 1) throw usageError(this)
    const o = deps.options
    const blind = bool(p, "no-transcript")
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
      const model = str(p, "model") ?? (input ? host?.contextModel?.(input) : undefined)
      const session = str(p, "session") ?? (input ? host?.sessionOf?.(input) : undefined) ?? currentSession(ctx.root)
      const w = watch(ctx, session, tokens, o, input ? host?.transcriptPath?.(input) : undefined, model)
      if (!w) return 0
      if (str(p, "hook") !== undefined && host?.stopFor) ctx.out(host.stopFor(w.text))
      else ctx.err(messageLine({ id: w.to === "coordinator" ? "coordinator-handover-due" : "worker-bound-reached", level: "urgent", text: w.text }))
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
    if (bool(p, "read")) {
      const prev = role?.predecessor
      const file = prev?.transcript
      if (!prev || !file || !existsSync(file)) {
        throw new NaimaError(
          "no predecessor's conversation to read here: it is kept only when a coordinator handed over to this session, and not committed anywhere else",
        )
      }
      const messages = conversationOf(readFileSync(file, "utf8"))
      const from = str(p, "from")
      const lines = excerpt(
        messages,
        str(p, "find"),
        from === undefined ? undefined : positive(from, "--from", 1),
        positive(str(p, "last"), "--last", 20),
        positive(str(p, "width"), "--width", 600),
      )
      ctx.out(`predecessor ${prev.session}, handed over ${prev.at}: ${messages.length} messages in all${lines.length ? "" : "; none match"}`)
      for (const l of lines) ctx.out(l)
      return 0
    }
    if (bool(p, "status")) {
      ctx.out(
        role
          ? `coordinator: ${role.holder ?? "nobody (handed over, the successor has not taken the role)"}, since ${role.since}${
            session && role.holder === session ? " (this session)" : ""
          }`
          : "coordinator: no record yet (naima hello in the main checkout takes the role)",
      )
      for (const r of role?.retired.slice(-3) ?? []) ctx.out(`handed over: ${r.session} at ${r.at}`)
      if (role?.handing) {
        ctx.out(
          `handing over: ${role.handing.phase} since ${role.handing.since}${
            role.handing.reviewed ? `, decisions reviewed ${role.handing.reviewed.at}` : ", decisions not reviewed"
          }`,
        )
      }
      if (role?.predecessor?.transcript) ctx.out(`predecessor ${role.predecessor.session}: naima handover --read reads its conversation`)
      const fallback = windowOf(undefined, o)
      ctx.out(
        `window of a model the transcript does not name or nothing knows: ${fallback.tokens} tokens, ${
          fallback.source === "assumed" ? "the default, assumed (no share of it is stated as a fact)" : "as the project sets it (contextWindow)"
        }`,
      )
      for (const [m, n] of Object.entries(o.contextWindows)) ctx.out(`window of ${m}: ${n} tokens, as the project sets it (contextWindows)`)
      ctx.out(
        `the coordinator prepares a handover past ${percent(o.handoverAt)} of its model's window (handoverAt); a worker ends past ${
          percent(o.workerAt)
        } of its own (workerAt); a model whose window is published needs no option`,
      )
      const measured = ADAPTER_MEASURES()
      ctx.out(
        measured.length
          ? `context measure: ${measured.join(", ")}`
          : "context measure: none: no host Naima knows gives one, so nothing is measured and nothing is guessed",
      )
      return 0
    }
    // Everything else is the old coordinator's, in order: the suggestion, the owner's yes or no, the finalizing, the handover.
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
    const now = ctx.now().toISOString()
    const handing = (h: Partial<Handing> & { phase: Phase }): Handing => ({
      since: role.handing?.since ?? now,
      ...(role.handing?.reviewed ? { reviewed: role.handing.reviewed } : {}),
      ...(role.handing?.transcript ? { transcript: role.handing.transcript } : {}),
      ...(role.handing?.tokens !== undefined ? { tokens: role.handing.tokens } : {}),
      ...(role.handing?.window !== undefined ? { window: role.handing.window } : {}),
      ...(role.handing?.proposedAt ? { proposedAt: role.handing.proposedAt } : {}),
      ...(role.handing?.agreedAt ? { agreedAt: role.handing.agreedAt } : {}),
      ...h,
    })
    if (decisions) {
      const text = str(p, "reviewed")
      const file = str(p, "reviewed-file")
      if (text !== undefined && file !== undefined) throw usageError(this)
      const phase = role.handing?.phase ?? "due"
      if (text === undefined && file === undefined) {
        const said = ownerSaid(ctx, deps, role, session, true)
        for (const l of reviewTask(said.since, said)) ctx.out(l)
        const r = role.handing?.reviewed
        if (r && reviewCurrent(role, said)) ctx.out(`A review recorded ${r.at} is current: the owner has not spoken since.`)
        return 0
      }
      let body: string
      if (file !== undefined) {
        try {
          body = readFileSync(file, "utf8")
        } catch {
          throw new NaimaError(`the review file ${file} cannot be read`)
        }
      } else body = text!
      const list = checkedReview(body)
      requireSigned(ctx)
      writeRole(ctx.root, { ...role, handing: { ...handing({ phase }), reviewed: { at: now, list } } })
      ctx.out(
        `decisions review recorded (${list.split("\n").filter((l) => l.trim()).length} line${
          list.split("\n").filter((l) => l.trim()).length === 1 ? "" : "s"
        }, signed against the no-leaks checklist)`,
      )
      ctx.out(
        phase === "agreed"
          ? "Next: once the work in flight is landed or handed off, naima handover --done. If the owner says more first, record it and review again."
          : "The handover is suggested to the owner first (naima handover --propose); this review counts once the owner says yes and says nothing more.",
      )
      return 0
    }
    if (bool(p, "propose")) {
      const lines = inFlight(ctx, deps.claimsData(ctx)).length
      writeRole(ctx.root, { ...role, handing: handing({ phase: "proposed", proposedAt: now }) })
      const h = role.handing
      const size = h?.tokens !== undefined && h.window !== undefined
        ? `${h.tokens} tokens of ${h.share === undefined ? "an assumed" : "its"} ${h.window}-token window`
        : undefined
      for (const l of proposalText(lines, size)) ctx.out(l)
      return 0
    }
    if (bool(p, "postpone")) {
      const given = str(p, "tokens")
      if (given !== undefined && !/^\d+$/.test(given)) throw new NaimaError(`--tokens takes a whole number, got ${JSON.stringify(given)}`)
      const tokens = given !== undefined ? Number(given) : role.handing?.tokens
      writeRole(ctx.root, { ...role, handing: { ...handing({ phase: "postponed" }), ...(tokens !== undefined ? { tokens } : {}) } })
      ctx.out(`handover postponed: carry on with the owner; it is suggested again once the context has grown by ${percent(REMIND_SHARE)} of the window`)
      return 0
    }
    if (bool(p, "agreed")) {
      if (role.handing?.phase !== "proposed" && role.handing?.phase !== "agreed") {
        throw new NaimaError(
          `the handover was not suggested to the owner yet (${
            role.handing ? `it is ${role.handing.phase}` : "it has not begun"
          }): give the owner the suggestion naima handover --propose prints, and record the yes with --agreed only after it`,
        )
      }
      writeRole(ctx.root, { ...role, handing: handing({ phase: "agreed", agreedAt: role.handing.agreedAt ?? now }) })
      for (const l of finalizeText()) ctx.out(l)
      return 0
    }
    if (!bool(p, "done")) {
      throw new NaimaError(
        "a handover is suggested to the owner first: naima handover --propose prints the suggestion; on the owner's yes, naima handover --agreed lists what " +
          "to finalize, and naima handover --done hands over once it is done (naima handover --postpone on a no)",
      )
    }
    if (role.handing?.phase !== "agreed") {
      throw new NaimaError(
        `the owner has not said yes to a handover (${
          role.handing ? `it is ${role.handing.phase}` : "it has not begun"
        }): suggest it with naima handover --propose, record the yes with naima handover --agreed, finalize, then naima handover --done`,
      )
    }
    const said = ownerSaid(ctx, deps, role, session, blind)
    if (!reviewCurrent(role, said)) {
      ctx.out(
        role.handing.reviewed
          ? `Not handed over: the owner spoke after the review recorded ${role.handing.reviewed.at}; record what the owner said and review again.`
          : "Not handed over: no review of the owner's requests is recorded.",
      )
      for (const l of reviewTask(said.since, said)) ctx.out(l)
      return 1
    }
    // The transcript's private copy, before anything else passes: the successor reads the predecessor's whole conversation.
    let copy: string | undefined
    const t = transcriptOf(role, session)
    const dir = stateDir(ctx.root)
    if (t && dir) {
      mkdirSync(join(dir, "handover"), { recursive: true })
      copy = join(dir, "handover", `${session}.jsonl`)
      copyFileSync(t.file, copy)
    } else if (!blind) {
      throw new NaimaError(
        "this session's transcript cannot be found, so the successor could not read the conversation: if the host keeps none, repeat the command with --no-transcript",
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
      ...(copy
        ? ["", "The predecessor's full conversation is kept in the project's private state, never committed: naima handover --read prints excerpts."]
        : []),
    ].join("\n")
    // The note first: the role passes only once everything claimed is in it.
    const note = deps.writeNote(ctx, text, str(p, "ack"))
    writeRole(ctx.root, {
      holder: null,
      since: ctx.now().toISOString(),
      retired: [...role.retired, { session, at: ctx.now().toISOString() }].slice(-20),
      pending: { from: session, at: ctx.now().toISOString(), note, ...(copy ? { transcript: copy } : {}) },
    })
    setLimit(ctx.root, null)
    ctx.out(`wrote ${note}: the session note with what is in flight (${lines.length} line${lines.length === 1 ? "" : "s"})`)
    if (copy) ctx.out(`kept a private copy of this session's conversation for the successor (never committed)`)
    ctx.out(`session ${session} gave the coordinator role up`)
    for (const l of successorText(note, copy)) ctx.out(l)
    return 0
  },
})

/** The hosts Naima knows that give a context measure, by name. */
const ADAPTER_MEASURES = (): string[] => ADAPTERS.filter((a) => !!a.contextTokens).map((a) => a.name)

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
        ? [
          `The previous coordinator handed over: read its session note ${r.note} (naima pass --list 1) and naima claims, then resume what was in flight.`,
          ...(r.transcript
            ? [
              `Its full conversation is kept privately at ${r.transcript}: naima handover --read --find <words> prints excerpts, --last <n> its end. Read what the note leaves open before asking the owner to repeat anything.`,
            ]
            : []),
        ]
        : [],
    }
  },
})
