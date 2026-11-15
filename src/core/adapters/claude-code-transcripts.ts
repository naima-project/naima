// Claude Code's transcripts, read to brief the worker that resumes a dead or
// stuck one (features/recovering-dead-stuck-worker-reads-tail-agent). Claude
// Code keeps one JSON-lines file per session under its configuration folder
// (CLAUDE_CONFIG_DIR, else ~/.claude):
//
//   projects/<cwd>/<session>.jsonl                     a session started in <cwd>
//   projects/<cwd>/<session>/subagents/agent-<id>.jsonl a sub-agent of that session
//
// <cwd> is the session's working directory with every character that is not
// a letter or a digit replaced by "-". A worker is either a session started in
// its worktree, or a sub-agent of the coordinator's session started in the
// main checkout, whose transcript names the worktree or the branch. Only the
// last entries are returned, each cut short: the resuming worker's context
// stays small, and nothing here writes a file.

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs"
import { join } from "node:path"
import type { ConversationMessage, TranscriptEntry, TranscriptReader, TranscriptTail, WorkerPlace } from "./index.ts"

/** The longest an entry's text is kept, in characters. */
const CUT = 240

/** Claude Code's configuration folder, where its transcripts are: null when the environment names no home. */
function configDir(env: Record<string, string | undefined>): string | null {
  const own = env["CLAUDE_CONFIG_DIR"]
  if (own) return own
  const home = env["HOME"] ?? env["USERPROFILE"]
  return home ? join(home, ".claude") : null
}

/** A working directory as Claude Code names its folder of transcripts. */
export const projectFolder = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, "-")

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v)

const files = (dir: string, suffix: string): string[] => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(suffix)).map((f) => join(dir, f))
  } catch {
    return []
  }
}

const mtime = (file: string): number => {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
}

/** Every transcript in a project folder: its sessions' and their sub-agents'. */
function transcriptsIn(project: string): string[] {
  if (!existsSync(project)) return []
  const sessions = files(project, ".jsonl")
  const subagents = readdirSync(project, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) =>
    files(join(project, d.name, "subagents"), ".jsonl")
  )
  return [...sessions, ...subagents]
}

const short = (text: string): string => {
  const one = text.replace(/\s+/g, " ").trim()
  return one.length > CUT ? `${one.slice(0, CUT - 1)}…` : one
}

/** What a tool call did, in a line: its command, its file or its description. */
function toolLine(block: Json): string {
  const input = isObject(block["input"]) ? block["input"] : {}
  const what = ["command", "file_path", "path", "pattern", "description", "prompt"].map((k) => input[k]).find((v) => typeof v === "string")
  return `${String(block["name"] ?? "tool")}: ${typeof what === "string" ? what : JSON.stringify(input)}`
}

const resultText = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
    ? content.map((c) => (isObject(c) && typeof c["text"] === "string" ? c["text"] : "")).join(" ")
    : ""

/** The entries one line of a transcript holds, in order: what was asked, said, run, and what a run gave back. */
function entriesOf(line: string): TranscriptEntry[] {
  let v: unknown
  try {
    v = JSON.parse(line)
  } catch {
    return []
  }
  if (!isObject(v) || (v["type"] !== "user" && v["type"] !== "assistant") || !isObject(v["message"])) return []
  const at = typeof v["timestamp"] === "string" ? { at: v["timestamp"] } : {}
  const content = v["message"]["content"]
  const user = v["type"] === "user"
  if (typeof content === "string") return content.trim() ? [{ ...at, kind: user ? "asked" : "said", text: short(content) }] : []
  if (!Array.isArray(content)) return []
  const out: TranscriptEntry[] = []
  for (const block of content) {
    if (!isObject(block)) continue
    if (block["type"] === "text" && typeof block["text"] === "string" && block["text"].trim()) {
      out.push({ ...at, kind: user ? "asked" : "said", text: short(block["text"]) })
    } else if (block["type"] === "tool_use") out.push({ ...at, kind: "ran", text: short(toolLine(block)) })
    else if (block["type"] === "tool_result") {
      const text = resultText(block["content"])
      if (text.trim()) out.push({ ...at, kind: "result", text: short(text) })
    }
  }
  return out
}

/** The last `count` entries of a transcript's text. */
export function lastEntries(text: string, count: number): TranscriptEntry[] {
  const lines = text.split("\n")
  const out: TranscriptEntry[] = []
  for (let i = lines.length - 1; i >= 0 && out.length < count; i--) {
    const line = lines[i]!.trim()
    if (line) out.unshift(...entriesOf(line))
  }
  return out.slice(-count)
}

/**
 * What was said in a session, in order: the owner's messages and the agent's replies, in full. Only text counts: a tool
 * call, a tool result, a sub-agent's turn, and the notices a hook or the tool itself puts in the owner's place (they
 * start with "<", or are the "[Request interrupted" line) are left out. `n` counts the messages from 1.
 */
export function messagesOf(text: string): ConversationMessage[] {
  const out: ConversationMessage[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    let v: unknown
    try {
      v = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObject(v) || (v["type"] !== "user" && v["type"] !== "assistant") || v["isSidechain"] === true || v["isMeta"] === true || !isObject(v["message"])) {
      continue
    }
    const who = v["type"] === "user" ? "owner" : "agent"
    const content = v["message"]["content"]
    const parts = typeof content === "string"
      ? [content]
      : Array.isArray(content)
      ? content.flatMap((b) => (isObject(b) && b["type"] === "text" && typeof b["text"] === "string" ? [b["text"]] : []))
      : []
    const said = parts.join("\n").trim()
    if (!said) continue
    if (who === "owner" && (said.startsWith("<") || said.startsWith("[Request interrupted"))) continue
    out.push({ n: out.length + 1, who, text: said, ...(typeof v["timestamp"] === "string" ? { at: v["timestamp"] } : {}) })
  }
  return out
}

/** The file of the session `session`: projects/<cwd>/<session>.jsonl under the configuration folder, the most recent when several folders hold one. */
export function locateTranscript(env: Record<string, string | undefined>, session: string): string | undefined {
  const dir = configDir(env)
  if (!dir || !/^[A-Za-z0-9_-]+$/.test(session)) return undefined
  const projects = join(dir, "projects")
  let folders: string[]
  try {
    folders = readdirSync(projects)
  } catch {
    return undefined
  }
  return folders.map((f) => join(projects, f, `${session}.jsonl`)).filter((f) => existsSync(f)).sort((a, b) => mtime(b) - mtime(a))[0]
}

export const claudeCodeTranscripts: TranscriptReader = {
  messages: messagesOf,
  locate: locateTranscript,
  roots(env) {
    const dir = configDir(env)
    return dir ? [join(dir, "projects")] : []
  },
  tail(env, place: WorkerPlace, count: number): TranscriptTail | undefined {
    const dir = configDir(env)
    if (!dir) return undefined
    const projects = join(dir, "projects")
    const since = place.since ? Date.parse(place.since) : NaN
    const fresh = (f: string) => Number.isNaN(since) || mtime(f) >= since - 60_000
    // A session started in the worktree is the worker's own.
    const own = place.worktree ? transcriptsIn(join(projects, projectFolder(place.worktree))).filter(fresh) : []
    // A sub-agent of a session in the main checkout is the worker when its transcript names the worktree or the branch.
    const marks = [place.worktree, place.branch].filter((m): m is string => !!m)
    const subagents = place.main
      ? transcriptsIn(join(projects, projectFolder(place.main))).filter((f) => /[\\/]subagents[\\/]/.test(f) && fresh(f)).filter((f) => {
        try {
          const text = readFileSync(f, "utf8")
          return marks.some((m) => text.includes(m))
        } catch {
          return false
        }
      })
      : []
    const latest = [...own, ...subagents].sort((a, b) => mtime(b) - mtime(a))[0]
    if (!latest) return undefined
    return { file: latest, entries: lastEntries(readFileSync(latest, "utf8"), count) }
  },
}

// ── how full the context is ──────────────────────────────────────────────────
// The last assistant message of a transcript carries the usage of the request that produced it: what that request
// read is the context now (input tokens plus those written to and read from the cache). Only the end of the file is
// read: the last megabyte holds many messages.

/** How much of the end of a transcript is read to find its last assistant message. */
const TAIL_BYTES = 1 << 20

/** The context size in tokens from the last assistant message of a transcript's text; undefined when it has none. */
export function contextTokensOf(text: string): number | undefined {
  const lines = text.split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    if (!line.includes('"usage"')) continue
    let v: unknown
    try {
      v = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObject(v) || v["type"] !== "assistant" || v["isSidechain"] === true || !isObject(v["message"])) continue
    const message = v["message"]
    const usage = message["usage"]
    if (message["model"] === "<synthetic>" || !isObject(usage) || typeof usage["input_tokens"] !== "number") continue
    const n = (k: string): number => (typeof usage[k] === "number" ? usage[k] : 0)
    return n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens")
  }
  return undefined
}

/** The transcript's path from what a Claude Code hook is given on standard input. */
export function transcriptPathOf(input: string): string | undefined {
  try {
    const v: unknown = JSON.parse(input)
    return isObject(v) && typeof v["transcript_path"] === "string" && v["transcript_path"] ? v["transcript_path"] : undefined
  } catch {
    return undefined
  }
}

/** The context size in tokens, from a hook's input: its transcript's end read. Undefined when the input names no readable transcript. */
export function contextTokensFromInput(input: string): number | undefined {
  const path = transcriptPathOf(input)
  if (!path) return undefined
  let fd: number | undefined
  try {
    fd = openSync(path, "r")
    const size = statSync(path).size
    const start = Math.max(0, size - TAIL_BYTES)
    const buffer = Buffer.alloc(size - start)
    readSync(fd, buffer, 0, buffer.length, start)
    return contextTokensOf(buffer.toString("utf8"))
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
