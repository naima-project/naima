// The decisions check of a coordinator's handover (features/coordinator-hands-over-fresh-session-when-context): before the
// coordinator proposes handing over, every request and decision the owner gave it in the conversation must be in the
// tracker, because the successor knows only the tracker, the session note and the transcript. The check reads what the
// owner said since the last session note from the transcript and the tracker's records, and lists what no record answers.
//
// Whether a message is a request or a decision is the agent's judgement, so the check is deliberately conservative and
// mechanical: an owner message that is long enough to say something, and is not a short question, is covered when
//   (a) a record this session filed lies in time between that message and the next such message (the turn that answered it), or
//   (b) a record filed or touched after the message shares at least three significant words with it (two for a short one).
// What is left is listed with an id; the agent files it, or waives it with `naima handover --waive <id>` when nothing needs
// recording (the owner thinking aloud, a thanks). The check never decides that a request is filed correctly; it finds the ones
// with no trace at all.

import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import type { Context, ConversationMessage } from "../../core/api.ts"

/** The shortest owner message that can hold a request or a decision, in characters. */
export const MIN_MESSAGE = 40
/** A message ending in a question mark is a question, not a request, up to this length. */
export const QUESTION_MAX = 160
/** The shared significant words that tie a record to a message. */
export const SHARED_WORDS = 3

/** One thing the tracker holds: an item, a diary entry, a decision, a session note. */
export interface TrackerRecord {
  kind: string
  /** The instant it was filed, when it says. */
  at?: string
  /** The instant its files last changed. */
  touched: string
  session?: string
  text: string
}

/** A directory of the data that holds no record of what the owner said. */
const NOT_RECORDS = new Set(["claims", "checkpoints", "metrics", "hooks", "rules", "rule-reviews", "waivers", "releases", "audits"])

const STOP = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "being",
  "could",
  "doing",
  "every",
  "first",
  "from",
  "have",
  "into",
  "just",
  "like",
  "make",
  "more",
  "need",
  "only",
  "other",
  "should",
  "since",
  "still",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "want",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "will",
  "with",
  "would",
  "your",
  "there's",
  "that's",
])

/** The words of a text that can tie it to another: lower case, at least five letters, not common. */
export function wordsOf(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 5 && !STOP.has(w)))
}

function frontMatter(text: string): { head: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!m) return { head: {}, body: text }
  const head: Record<string, string> = {}
  for (const l of m[1]!.split("\n")) {
    const i = l.indexOf(":")
    if (i > 0) head[l.slice(0, i).trim()] = l.slice(i + 1).trim()
  }
  return { head, body: m[2]! }
}

const mtime = (f: string): string => {
  try {
    return statSync(f).mtime.toISOString()
  } catch {
    return ""
  }
}

const read = (f: string): string => {
  try {
    return readFileSync(f, "utf8")
  } catch {
    return ""
  }
}

/** Every record of the tracker's data that was filed or touched at or after `since`: items, events (the diary), decisions, session notes. */
export function recordsSince(ctx: Context, since: string): TrackerRecord[] {
  const out: TrackerRecord[] = []
  const root = ctx.trackerRoot
  let types: string[]
  try {
    types = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !NOT_RECORDS.has(d.name)).map((d) => d.name)
  } catch {
    return out
  }
  for (const type of types) {
    let entries: import("node:fs").Dirent[]
    try {
      entries = readdirSync(join(root, type), { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        const meta = join(root, type, e.name, "meta.json")
        const readme = join(root, type, e.name, "README.md")
        const touched = [mtime(meta), mtime(readme)].sort().at(-1) ?? ""
        let at: string | undefined
        let session: string | undefined
        let title = ""
        let origin: Record<string, unknown> = {}
        if (existsSync(meta)) {
          try {
            const m = JSON.parse(read(meta)) as Record<string, unknown>
            title = typeof m["title"] === "string" ? m["title"] : ""
            origin = typeof m["origin"] === "object" && m["origin"] !== null ? (m["origin"] as Record<string, unknown>) : {}
          } catch {
            // a malformed meta.json is naima check's to report
          }
        }
        if (typeof origin["on"] === "string") at = origin["on"]
        if (typeof origin["session"] === "string") session = origin["session"]
        if ((at ?? touched) < since && touched < since) continue
        out.push({ kind: type, ...(at ? { at } : {}), touched, ...(session ? { session } : {}), text: `${title}\n${read(readme)}` })
      } else if (e.name.endsWith(".md")) {
        const file = join(root, type, e.name)
        const touched = mtime(file)
        const { head, body } = frontMatter(read(file))
        const at = head["at"]
        if ((at ?? touched) < since && touched < since) continue
        out.push({ kind: type, ...(at ? { at } : {}), touched, text: body })
      }
    }
  }
  return out
}

/** An owner message the check asks about. */
export interface Owed {
  /** A short stable id: `naima handover --waive <id>` clears it. */
  id: string
  at?: string
  text: string
}

export const idOf = (m: ConversationMessage): string => createHash("sha1").update(`${m.at ?? ""}\n${m.text}`).digest("hex").slice(0, 8)

/** Does an owner message hold something that may need recording? */
export function substantive(m: ConversationMessage): boolean {
  if (m.who !== "owner") return false
  const t = m.text.trim()
  if (t.length < MIN_MESSAGE) return false
  if (t.endsWith("?") && t.length < QUESTION_MAX) return false
  return true
}

/**
 * The owner's messages since `since` that no record answers, and are not waived. `messages` is the session's whole
 * conversation; `records` the tracker's records since `since` (recordsSince); `session` the session that files them.
 */
export function missingDecisions(
  messages: ConversationMessage[],
  records: TrackerRecord[],
  since: string,
  session: string,
  waived: readonly string[],
  now: string,
): Owed[] {
  const asked = messages.filter(substantive).filter((m) => (m.at ?? "") >= since)
  const missing: Owed[] = []
  asked.forEach((m, i) => {
    const id = idOf(m)
    if (waived.includes(id)) return
    const from = m.at ?? since
    const until = asked[i + 1]?.at ?? now
    const own = records.some((r) => r.session === session && r.at !== undefined && r.at >= from && r.at < until)
    if (own) return
    const words = wordsOf(m.text)
    const need = words.size < 6 ? 2 : SHARED_WORDS
    const shared = records.some((r) => {
      if ((r.at ?? r.touched) < from && r.touched < from) return false
      let n = 0
      for (const w of wordsOf(r.text)) if (words.has(w) && ++n >= need) return true
      return false
    })
    if (!shared) missing.push({ id, ...(m.at ? { at: m.at } : {}), text: m.text.replace(/\s+/g, " ").trim() })
  })
  return missing
}
