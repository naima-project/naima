// Private infrastructure in tracker text: machine names, IP addresses, URIs
// with a port, home-directory paths, the user's name, and the words of a
// private list kept outside every repository. Every write of tracker text the
// CLI makes is checked before anything is on disk and refused when it holds
// one; the author rewrites it with placeholders, or lets a deliberate mention
// through with `--allow-private "<reason>"`, which is recorded. Nothing is
// ever rewritten silently. Scrubbing is the project's choice, asked of the
// owner once: the privacy plugin's option `privateData`, `scrub` (the default)
// or `keep`, which lets the tracker's writes through while the tracker is
// private; what leaves the project is scrubbed either way
// (docs/guide/rules.md#no-machine-names-or-private-infrastructure-in-a-repository).

import { readFileSync } from "node:fs"
import { isIPv6 } from "node:net"
import { homedir, hostname } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { NaimaError } from "./errors.ts"

/** What each kind of finding is called, one and several, and the placeholder that replaces it. */
export const KINDS = {
  path: { says: "home-directory path", plural: "home-directory paths", placeholder: "<path>" },
  uri: { says: "URI with a port", plural: "URIs with a port", placeholder: "<host>" },
  ip: { says: "IP address", plural: "IP addresses", placeholder: "<ip>" },
  word: { says: "word of the private list", plural: "words of the private list", placeholder: "<host>" },
  host: { says: "machine name", plural: "machine names", placeholder: "<host>" },
  user: { says: "user name", plural: "user names", placeholder: "<user>" },
} as const

export type PrivateKind = keyof typeof KINDS

/** One private thing found in a text: its kind, the line it is on (from 1), and the text matched. */
export interface PrivateFinding {
  kind: PrivateKind
  line: number
  text: string
}

/** What is private on this machine, besides the generic patterns: its name, the user's name, the private list's words. */
export interface PrivateContext {
  host?: string | undefined
  user?: string | undefined
  words: string[]
}

/** The environment variables the launcher hands the program, which may not ask the system or read the user's config itself. */
export const PRIVATE_ENV = { host: "NAIMA_PRIVATE_HOST", user: "NAIMA_PRIVATE_USER", words: "NAIMA_PRIVATE_WORDS" } as const

/**
 * Where the private word list is: one word or name per line, `#` starting a comment.
 * `$XDG_CONFIG_HOME/naima/private-words`, else `~/.config/naima/private-words`; on Windows `%APPDATA%\naima\private-words`.
 */
export function privateWordsFile(env: Record<string, string | undefined>, os: string): string {
  if (os === "windows" && env["APPDATA"]) return join(env["APPDATA"], "naima", "private-words")
  const config = env["XDG_CONFIG_HOME"] || join(env["HOME"] || env["USERPROFILE"] || safe(homedir) || ".", ".config")
  return join(config, "naima", "private-words")
}

/** The words of a private list's text: one per line, blank lines and `#` comments left out. */
export const wordsOf = (text: string): string[] => text.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean)

function safe(f: () => string): string | undefined {
  try {
    return f() || undefined
  } catch {
    return undefined
  }
}

function readWords(file: string): string[] {
  try {
    return wordsOf(readFileSync(file, "utf8"))
  } catch {
    return []
  }
}

/**
 * What the launcher adds to the program's environment: the machine's name and the private list, read with the
 * launcher's permissions. A value the caller already set is kept.
 */
export function privateEnv(env: Record<string, string | undefined>, os: string): Record<string, string> {
  const out: Record<string, string> = {}
  const host = env[PRIVATE_ENV.host] ?? safe(hostname)
  if (host) out[PRIVATE_ENV.host] = host
  const user = env[PRIVATE_ENV.user] ?? env["USER"] ?? env["USERNAME"] ?? env["LOGNAME"]
  if (user) out[PRIVATE_ENV.user] = user
  out[PRIVATE_ENV.words] = env[PRIVATE_ENV.words] ?? readWords(privateWordsFile(env, os)).join("\n")
  return out
}

/** This process's private context: from the launcher's variables, else asked directly (a test, a run with every permission). */
export function privateContext(env: Record<string, string | undefined> = processEnv(), os: string = platform()): PrivateContext {
  const host = env[PRIVATE_ENV.host] ?? safe(hostname)
  const user = env[PRIVATE_ENV.user] ?? env["USER"] ?? env["USERNAME"] ?? env["LOGNAME"]
  const given = env[PRIVATE_ENV.words]
  const words = given !== undefined ? wordsOf(given) : readWords(privateWordsFile(env, os))
  return { host, user, words }
}

function processEnv(): Record<string, string | undefined> {
  try {
    return { ...process.env }
  } catch {
    return {}
  }
}

const platform = (): string => (process.platform === "win32" ? "windows" : process.platform)

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** A name no detector reports: too short, or a word every machine has. */
const GENERIC = new Set(["localhost", "root", "user", "users", "admin", "runner", "ubuntu", "debian", "home", "shared", "public", "default", "guest", "test"])

/** Hosts a document may name with a port: the loopback and the names reserved for examples (RFC 2606, RFC 6761). */
function publicHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "")
  if (h.startsWith("<") && h.endsWith(">")) return true
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127\./.test(h) || h === "0.0.0.0") return true
  return /(^|\.)(example\.(com|org|net)|invalid|test|example)$/.test(h)
}

interface Pattern {
  kind: PrivateKind
  pattern: RegExp
  keep?: (m: RegExpExecArray) => boolean
}

const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)"

const GENERIC_PATTERNS: Pattern[] = [
  {
    kind: "path",
    pattern: /(?<![\w.~\/\\-])(?:\/Users\/|\/home\/|[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/])([^\s\\/<>"'`)\]]+)[^\s"'`)\]>]*/g,
    keep: (m) => !GENERIC.has((m[1] ?? "").toLowerCase()),
  },
  {
    kind: "uri",
    pattern: /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:[^\s\/?#@]*@)?(\[[^\]\s]*\]|[^\s\/?#:\[\]]+):\d{1,5}(?!\d)[^\s)\]>"'`]*/g,
    keep: (m) => !publicHost(m[1] ?? ""),
  },
  {
    kind: "ip",
    pattern: new RegExp(`(?<![\\w.])(?:${OCTET}\\.){3}${OCTET}(?![\\w])(?!\\.\\d)`, "g"),
    keep: (m) => !/^127\./.test(m[0]) && m[0] !== "0.0.0.0",
  },
  {
    kind: "ip",
    pattern: /(?<![\w:.])[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){2,7}(?![\w:])/g,
    keep: (m) => /\d/.test(m[0]) && isIPv6(m[0]) && m[0] !== "::1" && !/^::$/.test(m[0]),
  },
]

function namePatterns(ctx: PrivateContext): Pattern[] {
  const out: Pattern[] = []
  const word = (kind: PrivateKind, name: string, flags: string) => {
    if (name.length < 3 || GENERIC.has(name.toLowerCase())) return
    out.push({ kind, pattern: new RegExp(`(?<![\\w-])${escape(name)}(?![\\w-])`, flags) })
  }
  for (const w of ctx.words) word("word", w, "gi")
  if (ctx.host) {
    word("host", ctx.host, "gi")
    const first = ctx.host.split(".")[0] ?? ""
    if (first !== ctx.host && first.length >= 4) word("host", first, "gi")
  }
  // Case-sensitive: a login name is lowercase as a rule, and the same letters capitalised are a person's name, not the account.
  if (ctx.user) word("user", ctx.user, "g")
  return out
}

/** The lines core writes on its own, never the author's: a note's dated heading, which names its writer and branch. */
const OWN_LINE = /^### \d{4}-\d{2}-\d{2} — /

/**
 * Every private thing in `text`, in order. A match inside one already found (a user name inside a home path) is
 * not reported again; a note's own heading line is not read.
 */
export function findPrivate(text: string, ctx: PrivateContext): PrivateFinding[] {
  const spans: { start: number; end: number; kind: PrivateKind; text: string }[] = []
  const lines = text.split("\n")
  const starts: number[] = []
  let at = 0
  for (const l of lines) {
    starts.push(at)
    at += l.length + 1
  }
  const lineOf = (i: number): number => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if ((starts[mid] ?? 0) <= i) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
  for (const p of [...GENERIC_PATTERNS, ...namePatterns(ctx)]) {
    p.pattern.lastIndex = 0
    for (let m = p.pattern.exec(text); m !== null; m = p.pattern.exec(text)) {
      if (m[0] === "") {
        p.pattern.lastIndex++
        continue
      }
      if (p.keep && !p.keep(m)) continue
      const start = m.index
      const end = start + m[0].length
      if (OWN_LINE.test(lines[lineOf(start) - 1] ?? "")) continue
      if (spans.some((s) => start < s.end && end > s.start)) continue
      spans.push({ start, end, kind: p.kind, text: m[0] })
    }
  }
  return spans.sort((a, b) => a.start - b.start).map((s) => ({ kind: s.kind, line: lineOf(s.start), text: s.text }))
}

/**
 * `text` with every private thing `findPrivate` finds replaced by its placeholder — `<path>`, `<host>`, `<ip>`,
 * `<user>` — for evidence a tool printed, which is kept exactly but for these.
 */
export function redactPrivate(text: string, ctx: PrivateContext): string {
  let out = text
  for (const f of findPrivate(text, ctx).sort((a, b) => b.text.length - a.text.length)) out = out.split(f.text).join(KINDS[f.kind].placeholder)
  return out
}

/** The findings of `after` that `before` does not already hold: what a write adds, so an old mention does not block every later write. */
export function addedPrivate(before: string, after: string, ctx: PrivateContext): PrivateFinding[] {
  const had = new Map<string, number>()
  for (const f of findPrivate(before, ctx)) had.set(`${f.kind}\0${f.text}`, (had.get(`${f.kind}\0${f.text}`) ?? 0) + 1)
  return findPrivate(after, ctx).filter((f) => {
    const key = `${f.kind}\0${f.text}`
    const n = had.get(key) ?? 0
    if (n > 0) {
      had.set(key, n - 1)
      return false
    }
    return true
  })
}

/** The flag that lets a deliberate mention through, with its reason. */
export const ALLOW_PRIVATE = "--allow-private"

/** The arguments without `--allow-private <reason>` (or `--allow-private=<reason>`), and the reason; nothing after `--` is read. */
export function allowPrivateOption(args: string[]): { reason?: string | undefined; rest: string[] } {
  const { value, rest } = globalOption(args, ALLOW_PRIVATE, `${ALLOW_PRIVATE} needs a reason: ${ALLOW_PRIVATE} "<why this mention is deliberate>"`)
  return { reason: value, rest }
}

/** The flag that signs a write of free text or a file against the no-leaks checklist, with the checklist's path. */
export const REVISED = "--revised"

/** The arguments without `--revised <path>` (or `--revised=<path>`), and the path; nothing after `--` is read. */
export function revisedOption(args: string[]): { path?: string | undefined; rest: string[] } {
  const { value, rest } = globalOption(args, REVISED, `${REVISED} needs a path: ${REVISED} <the no-leaks checklist the program ships>`)
  return { path: value, rest }
}

/** The arguments without `<flag> <value>` (or `<flag>=<value>`), and the value, trimmed; an empty value is refused with `empty`. */
function globalOption(args: string[], flag: string, empty: string): { value?: string | undefined; rest: string[] } {
  const rest: string[] = []
  let value: string | undefined
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    if (a === "--") {
      rest.push(...args.slice(i))
      break
    }
    if (a === flag || a.startsWith(`${flag}=`)) {
      const v = a === flag ? args[++i] : a.slice(flag.length + 1)
      if (!v?.trim()) throw new NaimaError(empty, "usage")
      value = v.trim()
      continue
    }
    rest.push(a)
  }
  return { value, rest }
}

/** Counts by kind, never the values: "2 machine names, 1 IP address". */
export function countsOf(findings: PrivateFinding[]): string {
  const n = new Map<PrivateKind, number>()
  for (const f of findings) n.set(f.kind, (n.get(f.kind) ?? 0) + 1)
  return [...n].map(([k, c]) => `${c} ${c > 1 ? KINDS[k].plural : KINDS[k].says}`).join(", ")
}

/** What a project does with private data in its tracker: `scrub` refuses it (the default), `keep` lets it through. */
export type PrivateData = "scrub" | "keep"

/** The choices, in the order they are offered. */
export const PRIVATE_DATA_MODES: readonly PrivateData[] = ["scrub", "keep"]

/** The privacy plugin's option that holds the project's choice; absent, the project has not chosen and scrubs. */
export const PRIVATE_DATA_OPTION = "privateData"

/** The project's choice, read from its configuration: undefined while it has not chosen; refused when it is neither choice. */
export function privateDataOf(config: { plugins: Record<string, { options?: Record<string, unknown> } | undefined> }): PrivateData | undefined {
  const value = config.plugins["privacy"]?.options?.[PRIVATE_DATA_OPTION]
  if (value === undefined) return undefined
  if (!PRIVATE_DATA_MODES.includes(value as PrivateData)) {
    throw new NaimaError(`privacy: option ${PRIVATE_DATA_OPTION} must be ${PRIVATE_DATA_MODES.join(" or ")}; got ${JSON.stringify(value)}`, "usage")
  }
  return value as PrivateData
}

/** The reason recorded when a write goes through because the project keeps private data. */
export const KEEP_REASON = `the project keeps private data in its tracker (privacy option ${PRIVATE_DATA_OPTION}: keep)`

/** The question a refusal carries while the project has not chosen: the agent puts it to the owner once. */
export const PRIVATE_DATA_QUESTION =
  `This project has not chosen whether Naima scrubs private data: ask the owner once whether to keep scrubbing it (naima privacy scrub, the default) or to keep it in this project's tracker (naima privacy keep), and record the answer; what leaves the project (a report sent upstream, a published site, a public repository) is scrubbed either way.`

/** Whether this command's project has chosen, set by the CLI before a command runs; a refusal asks only while it has not. */
let chosen = false

/** Record whether the project running the command has chosen what to do with private data. */
export function setPrivateDataChosen(value: boolean): void {
  chosen = value
}

/**
 * Apply the project's choice to the command about to run: a refusal asks the owner while the project has not
 * chosen; with keep, and the tracker private, every write goes through with KEEP_REASON recorded, unless the
 * command gave its own reason.
 */
export function applyPrivateData(
  ctx: { config: Parameters<typeof privateDataOf>[0]; allowPrivate?: string | undefined },
  trackerPrivate: boolean,
): PrivateData | undefined {
  const choice = privateDataOf(ctx.config)
  setPrivateDataChosen(choice !== undefined)
  if (choice === "keep" && trackerPrivate && ctx.allowPrivate === undefined) ctx.allowPrivate = KEEP_REASON
  return choice
}

/**
 * The refusal of a write that holds private infrastructure: each finding with its line and what replaces it, and
 * how to go on; while the project has not chosen whether to scrub, the question for the owner. `what` names the
 * text ("the note", "field title").
 */
export function privateRefusal(what: string, findings: PrivateFinding[], hasChosen: boolean = chosen): string {
  const list = findings.map((f) => `  ${what}, line ${f.line}: ${KINDS[f.kind].says} ${JSON.stringify(f.text)} — write ${KINDS[f.kind].placeholder}`)
  return [
    `nothing written: the text holds private infrastructure, which this project's tracker does not carry — rewrite it with placeholders and run the command again:`,
    ...list,
    `A deliberate mention goes through with ${ALLOW_PRIVATE} "<reason>", and the reason is recorded.`,
    ...(hasChosen ? [] : [PRIVATE_DATA_QUESTION]),
  ].join("\n")
}

/**
 * Check a text about to be written: nothing found, undefined; found and let through by `allow`, the line that
 * records it; found and not let through, a refusal thrown before anything is on disk.
 */
export function guardPrivate(what: string, findings: PrivateFinding[], allow: string | undefined): string | undefined {
  if (!findings.length) return undefined
  if (allow === undefined) throw new NaimaError(privateRefusal(what, findings), "private")
  return allowanceLine(allow, findings)
}

/** What records a mention let through: the reason and the counts by kind, never the values. */
export const allowanceLine = (reason: string, findings: PrivateFinding[]): string =>
  `Private infrastructure let through on purpose (${ALLOW_PRIVATE}): ${reason} — ${countsOf(findings)}.`
