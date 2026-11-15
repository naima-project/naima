// The coordinator's handover to a fresh session: a coordinator session degrades
// as its context fills, so it measures how full the context is and, past a
// threshold, hands over, in steps the owner is part of: it finishes the work in
// progress, checks that every request and decision of the owner is recorded
// (handover-decisions.ts), proposes the handover to the owner in a reassuring
// message and, once the owner agrees, records where its transcript is kept,
// writes the session note, gives the coordinator role up and prints what starts
// its successor (features/coordinator-hands-over-fresh-session-when-context).
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
// assistant message's usage is the context size (core/adapters). A host without
// one has no measure, and nothing here guesses it.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import {
  adapter,
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
import { missingDecisions, type Owed, recordsSince } from "./handover-decisions.ts"
import { aheadBehind } from "./worktrees.ts"

// ── the options ──────────────────────────────────────────────────────────────

/** The context window, in tokens, when the project names none. */
export const DEFAULT_WINDOW = 200_000
/** The share of the window past which the coordinator starts handing over, when the project names none: the owner's choice, the usual one. */
export const DEFAULT_HANDOVER_AT = 0.6
/** After the owner postpones, the coordinator is reminded once its context has grown by this share of the window. */
export const REMIND_SHARE = 0.05

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
  /** The tokens past which the coordinator starts handing over. */
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

/** Where the old coordinator is in handing over, once past the threshold (or asked to): the states of the model after reach_threshold. */
export type Phase = "finishing" | "checking" | "proposed" | "postponed"

export interface Handing {
  phase: Phase
  since: string
  /** The transcript file the host named, as the turn-end hook was given it. */
  transcript?: string
  /** The context size when it was last seen: a postponement reminds again once it has grown. */
  tokens?: number
  /** The decisions check has passed since the owner last said something that needed a record. */
  checked?: boolean
  /** The ids of owner messages the coordinator judged to need no record. */
  waived: string[]
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
      ? { from: p["from"], at: p["at"], note: p["note"], ...(typeof p["transcript"] === "string" ? { transcript: p["transcript"] } : {}) }
      : undefined
    const h = v["handing"]
    const handing: Handing | undefined = isObject(h) && ["finishing", "checking", "proposed", "postponed"].includes(String(h["phase"])) &&
        typeof h["since"] === "string"
      ? {
        phase: h["phase"] as Phase,
        since: h["since"],
        ...(typeof h["transcript"] === "string" ? { transcript: h["transcript"] } : {}),
        ...(typeof h["tokens"] === "number" ? { tokens: h["tokens"] } : {}),
        ...(h["checked"] === true ? { checked: true } : {}),
        waived: Array.isArray(h["waived"]) ? h["waived"].filter((x): x is string => typeof x === "string") : [],
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
export function takeRole(
  ctx: Context,
  session: string,
  options: HandoverOptions,
): { took: boolean; from?: string; note?: string; transcript?: string } {
  const role = readRole(ctx.root)
  const now = ctx.now().toISOString()
  if (role?.holder === session) {
    setLimit(ctx.root, limitOf(options))
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
  setLimit(ctx.root, limitOf(options))
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
  /** The instant of the newest session note, ISO 8601: the decisions check reads what the owner said since. */
  lastNoteAt(ctx: Context): string | undefined
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

/** What the coordinator is told when its context is past the threshold: the text of the message. It does not hand over at once. */
export const handoverMessage = (d: Depth): string =>
  `Your context is ${d.tokens} tokens, ${percent(d.share)} of the ${d.window}-token window, past the ${d.limit}-token limit for handing over. ` +
  `Do not hand over yet, and start nothing new. Finish the work in progress. Then run naima handover --decisions: it lists the owner's requests and decisions of this ` +
  `session that have no record in the tracker; file each one (naima new, naima event --kind diary, a decision record) or waive it with --waive <id> when nothing ` +
  `needs recording, and run it again until it passes. Then run naima handover --propose, and give the owner the message it prints, saying what is saved, that ` +
  `nothing is lost and how the new chat continues. Hand over (naima handover --agreed) only after the owner agrees; if the owner postpones, run naima handover --postpone and go on.`

/**
 * What the turn end should say, or null: the coordinator past the threshold, the first time (and again once a postponement
 * has been outgrown). It starts the handing over, which records the transcript the host names. Nothing when the session is
 * not the holder of the role (a worker, or a session that already handed over), when the role has no record, when no
 * measure exists, or while the handing over is in hand: it is told once, not every turn.
 */
export function watch(
  ctx: Context,
  session: string | undefined,
  tokens: number | undefined,
  options: HandoverOptions,
  transcript?: string,
): { depth: Depth; text: string } | null {
  const role = readRole(ctx.root)
  if (!session || !role || role.holder !== session) return null
  const depth = depthOf(tokens, options)
  if (!depth || !depth.past) return null
  const h = role.handing
  const now = ctx.now().toISOString()
  if (h && h.phase !== "postponed") {
    if (!h.transcript && transcript) writeRole(ctx.root, { ...role, handing: { ...h, transcript } })
    return null
  }
  if (h && depth.tokens < (h.tokens ?? 0) + Math.floor(options.contextWindow * REMIND_SHARE)) return null
  const next: Handing = {
    phase: "finishing",
    since: now,
    tokens: depth.tokens,
    waived: h?.waived ?? [],
    ...((transcript ?? h?.transcript) ? { transcript: (transcript ?? h?.transcript)! } : {}),
  }
  writeRole(ctx.root, { ...role, handing: next })
  return { depth, text: handoverMessage(depth) }
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

/** The result of the decisions check. */
interface Checked {
  owed: Owed[]
  since: string
  said: number
}

/**
 * Compare what the owner said in this session since the last session note with what the tracker recorded since. Without a
 * transcript to read the check cannot run, and it refuses, unless `blind` says the coordinator judged by hand.
 */
function checkDecisions(ctx: Context, deps: HandoverDeps, role: Role, session: string, blind: boolean): Checked {
  const since = deps.lastNoteAt(ctx) ?? role.since
  const t = transcriptOf(role, session)
  if (!t) {
    if (blind) return { owed: [], since, said: 0 }
    throw new NaimaError(
      "the decisions check cannot read this session's transcript (the host gives none, or it is not where the host says): " +
        "go through the owner's requests since the last session note by hand, then repeat the command with --no-transcript",
    )
  }
  const messages = conversationOf(t.text)
  const owed = missingDecisions(messages, recordsSince(ctx, since), since, session, role.handing?.waived ?? [], ctx.now().toISOString())
  return { owed, since, said: messages.filter((m) => m.who === "owner" && (m.at ?? "") >= since).length }
}

function reportOwed(ctx: Context, c: Checked): void {
  if (!c.owed.length) {
    ctx.out(`decisions check passed: every request and decision the owner gave since ${c.since} has a record (or was waived)`)
    return
  }
  ctx.out(`decisions check: ${c.owed.length} owner message${c.owed.length === 1 ? "" : "s"} since ${c.since} with no record in the tracker:`)
  for (const o of c.owed) ctx.out(`- ${o.id} ${o.at ?? ""} ${cut(o.text, 200)}`)
  ctx.out(
    'File each one (naima new, a diary entry with naima event <today> "<what, why>" --kind diary, a decision record), or when nothing needs recording ' +
      "(thinking aloud, a thanks) waive it with naima handover --waive <id>; then run naima handover --decisions again.",
  )
}

/** What the owner is told, to relay: what is saved, that nothing is lost, how the new chat continues. */
function proposalText(c: Checked, lines: number, depth: string | undefined): string[] {
  return [
    "Give the owner this message, then wait for the answer. Hand over only after the owner agrees (naima handover --agreed); if the owner wants to go on, naima handover --postpone.",
    "",
    `> ${depth ? `This conversation is ${depth} full, and a fresh chat keeps me sharp. ` : "A fresh chat keeps me sharp. "}` +
    `Everything is saved: your requests and decisions of this session are in the tracker (the check found none missing), ` +
    `${lines} piece${
      lines === 1 ? "" : "s"
    } of work in flight will be written in a session note, and the full text of this conversation is kept privately in the project, never committed. ` +
    `Nothing is lost. To continue, you open a new chat in the project's main checkout and paste the message I give you; the new coordinator reads the note and ` +
    `this conversation and carries on where I stopped. Shall we do it now, or do you want to go on a while?`,
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
    "hand the coordinator role over to a fresh session, in steps the owner is part of: --decisions checks that every request and decision of the owner is recorded, --propose gives the message for the owner, --agreed (after the owner agrees) writes the session note, keeps the conversation's text for the successor and gives the role up; --postpone when the owner wants to go on; --read reads the predecessor's conversation; --status says how deep the context is, --watch is what the turn end runs",
  enforces:
    "only the session that holds the coordinator role hands over (naima hello in the main checkout takes it); the proposal comes only after the decisions check has passed since the owner last said something, and the handover only after the owner has agreed to it (--agreed) and the transcript's private copy is made; the handover writes the session note first, with every claim, the branches waiting to land, the runs and the open meeting, and gives the role up only once it is written; the session that gave it up is refused by land and by the push check, whatever it is told, and a worker's session is not affected",
  usage:
    'handover --decisions [--waive <id>[,<id>]] [--no-transcript] | handover --propose [--no-transcript] | handover --postpone [--tokens <n>] | handover --agreed [--ack "<line>"] [--note "<what else is in hand>"] [--no-transcript] | handover --read [--find <words> | --from <n>] [--last <n>] [--width <n>] | handover --status | handover --watch [--hook <tool>] [--tokens <n>] [--session <id>] | handover --check [<what>] | handover --take',
  options: [
    {
      name: "--decisions",
      says:
        "check that every request and decision the owner gave this session since the last session note has a record in the tracker; list the ones with none and exit 1, or pass",
    },
    { name: "--waive", says: "with --decisions: owner messages (by the ids the check printed, comma separated) that need no record" },
    {
      name: "--propose",
      says:
        "after the check passes (it is run again): print the message for the owner that proposes the handover, saying what is saved and how the new chat continues",
    },
    { name: "--postpone", says: "the owner wants to go on: leave the handing over, to be reminded once the context has grown by 5% of the window" },
    {
      name: "--agreed",
      says:
        "the owner agreed to the proposal: write the session note, keep a private copy of this session's transcript, give the role up and print the successor's start",
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
    { name: "--status", says: "say who holds the role, where it is in handing over, how deep the context is and the limit, or that the host gives no measure" },
    {
      name: "--watch",
      says:
        "what the turn-end hook runs: when this session holds the role and its context is past the limit, the first time, print the message that tells it how to hand over (as the tool's turn-end decision with --hook, as a NAIMA-MESSAGE line otherwise); nothing in every other case",
    },
    { name: "--hook", says: "with --watch: the tool whose hook runs it, read from standard input", default: "claude-code" },
    { name: "--tokens", says: "with --watch: the context size, instead of the one the hook input gives; with --postpone: the size to remind from" },
    { name: "--session", says: "with --watch: the session, instead of the hook input's or the current one" },
    { name: "--check", says: "exit 1 when this session gave the role up: for a script that publishes, as scripts/publish-site.sh does" },
    { name: "--take", says: "take the role for the current session, as naima hello does in the main checkout" },
  ],
  examples: [
    "handover --decisions",
    "handover --propose",
    'handover --agreed --ack "Acknowledge: Quiet mode on"',
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
      check: { type: "boolean" },
      take: { type: "boolean" },
      decisions: { type: "boolean" },
      waive: { type: "string" },
      propose: { type: "boolean" },
      postpone: { type: "boolean" },
      agreed: { type: "boolean" },
      "no-transcript": { type: "boolean" },
      read: { type: "boolean" },
      find: { type: "string" },
      from: { type: "string" },
      last: { type: "string" },
      width: { type: "string" },
    })
    const decisions = bool(p, "decisions") || str(p, "waive") !== undefined
    const modes = [
      ...["status", "watch", "check", "take", "propose", "postpone", "agreed", "read"].filter((m) => bool(p, m)),
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
      const session = str(p, "session") ?? (input ? host?.sessionOf?.(input) : undefined) ?? currentSession(ctx.root)
      const w = watch(ctx, session, tokens, o, input ? host?.transcriptPath?.(input) : undefined)
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
        ctx.out(`handing over: ${role.handing.phase} since ${role.handing.since}${role.handing.checked ? ", decisions checked" : ""}`)
      }
      if (role?.predecessor?.transcript) ctx.out(`predecessor ${role.predecessor.session}: naima handover --read reads its conversation`)
      ctx.out(`limit: ${limitOf(o)} tokens, ${percent(o.handoverAt)} of a ${o.contextWindow}-token window (coordination options contextWindow, handoverAt)`)
      const measured = ADAPTER_MEASURES()
      ctx.out(
        measured.length
          ? `context measure: ${measured.join(", ")}`
          : "context measure: none: no host Naima knows gives one, so nothing is measured and nothing is guessed",
      )
      return 0
    }
    // Everything else is the old coordinator's, in order: check, propose, then (the owner agreeing) hand over.
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
      waived: role.handing?.waived ?? [],
      ...(role.handing?.transcript ? { transcript: role.handing.transcript } : {}),
      ...(role.handing?.tokens !== undefined ? { tokens: role.handing.tokens } : {}),
      ...h,
    })
    if (decisions) {
      const ids = (str(p, "waive") ?? "").split(",").map((x) => x.trim()).filter(Boolean)
      const base: Role = ids.length
        ? { ...role, handing: handing({ phase: role.handing?.phase ?? "checking", waived: [...new Set([...(role.handing?.waived ?? []), ...ids])] }) }
        : role
      const c = checkDecisions(ctx, deps, base, session, blind)
      writeRole(ctx.root, {
        ...base,
        handing: { ...handing({ phase: "checking", waived: base.handing?.waived ?? [] }), ...(c.owed.length ? {} : { checked: true }) },
      })
      reportOwed(ctx, c)
      if (!c.owed.length) ctx.out("Next: finish what is in progress, then naima handover --propose.")
      return c.owed.length ? 1 : 0
    }
    if (bool(p, "propose")) {
      const c = checkDecisions(ctx, deps, role, session, blind)
      if (c.owed.length) {
        writeRole(ctx.root, { ...role, handing: handing({ phase: "checking" }) })
        reportOwed(ctx, c)
        ctx.out("Not proposed: the decisions check has to pass first.")
        return 1
      }
      const lines = inFlight(ctx, deps.claimsData(ctx)).length
      writeRole(ctx.root, { ...role, handing: { ...handing({ phase: "proposed" }), checked: true } })
      const tokens = role.handing?.tokens
      for (const l of proposalText(c, lines, tokens !== undefined ? percent(tokens / o.contextWindow) : undefined)) ctx.out(l)
      return 0
    }
    if (bool(p, "postpone")) {
      const given = str(p, "tokens")
      if (given !== undefined && !/^\d+$/.test(given)) throw new NaimaError(`--tokens takes a whole number, got ${JSON.stringify(given)}`)
      const tokens = given !== undefined ? Number(given) : role.handing?.tokens
      writeRole(ctx.root, { ...role, handing: { ...handing({ phase: "postponed" }), ...(tokens !== undefined ? { tokens } : {}) } })
      ctx.out(`handover postponed: carry on with the owner; you are reminded once the context has grown by ${percent(REMIND_SHARE)} of the window`)
      return 0
    }
    if (!bool(p, "agreed")) {
      throw new NaimaError(
        "a handover needs the owner's agreement first: finish the work in progress, naima handover --decisions until it passes, naima handover --propose, " +
          "give the owner its message, and run naima handover --agreed once the owner agrees (naima handover --postpone if the owner wants to go on)",
      )
    }
    if (role.handing?.phase !== "proposed") {
      throw new NaimaError(
        `the handover was not proposed to the owner yet (${
          role.handing ? `it is at ${role.handing.phase}` : "it has not begun"
        }): naima handover --propose first, after naima handover --decisions passes`,
      )
    }
    // The owner may have said more since the proposal: the check passes again, as the model requires after a decision.
    const c = checkDecisions(ctx, deps, role, session, blind)
    if (c.owed.length) {
      writeRole(ctx.root, { ...role, handing: handing({ phase: "checking" }) })
      reportOwed(ctx, c)
      ctx.out("Not handed over: the owner said more since the proposal. Record it, run naima handover --propose again and have the owner agree again.")
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
