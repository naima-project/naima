// The agent-harness entry-point check, and the one-line pointer `naima init`
// writes. Each agent tool reads its own always-on file (AGENTS.md, or the
// one its adapter names), mostly to point at the rulebook; if the pointer
// names a file that no longer exists, nothing errors — the agent is simply
// taught nothing. `naima check` reports any such broken reference in a
// configured entry file; `naima init` writes the one line that says where
// Naima is, and to run naima hello at the start of every session, into the
// host's AGENTS.md, else the first entry file it has, else a new AGENTS.md
// (features/agent-harness-entry-point-check-naima-init,
// features/naima-hello-runs-at-start-every-agent).

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { ADAPTERS } from "./adapters/index.ts"
import { posixRelative } from "./config.ts"
import { PROGRAM_DIR } from "./layout.ts"

/** The entry file every tool may read, and the one the pointer goes into first. */
export const AGENTS_FILE = "AGENTS.md"

/** The harness entry files a project is checked against, absent its own `entryFiles` in naima.json: AGENTS.md, then each adapter's. */
export const DEFAULT_ENTRY_FILES: readonly string[] = [AGENTS_FILE, ...ADAPTERS.map((a) => a.entryFile)]

/** One path or link an entry file names, naming a missing file. */
export interface BrokenLink {
  file: string
  target: string
}

/** `text` with every markdown link already matched blanked out, so a link's own target is not also read as a bare path. */
function blank(text: string, spans: readonly (readonly [number, number])[]): string {
  const chars = [...text]
  for (const [s, e] of spans) for (let i = s; i < e; i++) chars[i] = " "
  return chars.join("")
}

/** Every markdown-link target and bare relative-path-looking token in `text`, in the order they appear. */
function linksIn(text: string): string[] {
  const out: string[] = []
  const spans: [number, number][] = []
  for (const m of text.matchAll(/\[[^\]]*]\(([^)\s]+)\)/g)) {
    out.push(m[1] as string)
    spans.push([m.index as number, (m.index as number) + m[0].length])
  }
  const rest = blank(text, spans)
  for (const m of rest.matchAll(/(?<![\w./-])(\.{1,2}\/[\w.-]+(?:\/[\w.-]+)*|[\w-]+(?:\/[\w.-]+)+\.(?:md|ts|js|json|txt))(?![\w./-])/g)) {
    out.push(m[1] as string)
  }
  return out
}

/** `target` as a local path to resolve, or null when it is a URL (any `scheme:`, including `mailto:`) or a bare in-page anchor. */
function localTarget(target: string): string | null {
  const t = target.split("#")[0]?.trim()
  if (!t || /^[a-z][a-z0-9+.-]*:/i.test(t)) return null
  return t
}

/** Every link or plain-text path, in `root`'s configured entry files that exist, naming a file missing from disk. */
export function brokenEntryLinks(root: string, entryFiles: readonly string[]): BrokenLink[] {
  const out: BrokenLink[] = []
  for (const file of entryFiles) {
    const path = join(root, file)
    if (!existsSync(path)) continue
    const dir = dirname(path)
    // The pointer line is Naima's own, checked by session-start against where the tracker folder is.
    const text = readFileSync(path, "utf8").split("\n").filter((l) => !l.includes(POINTER_MARK)).join("\n")
    for (const raw of linksIn(text)) {
      const target = localTarget(raw)
      if (!target || existsSync(resolve(dir, target))) continue
      out.push({ file, target: raw })
    }
  }
  return out
}

/** What every pointer says, wherever its tracker folder is: how an entry file is known to hold one. */
const POINTER_MARK = "(naima/ the program, naima-data/ the data)"

/** The one line that tells agents where Naima is, and to run naima hello at the start of every session unless a session-start hook already did. */
export function pointerLine(root: string, tracker: string): string {
  const where = posixRelative(root, tracker)
  return `Naima is in ${where}/ ${POINTER_MARK}; at the start of every session, run \`deno run -A ${where}/${PROGRAM_DIR}/naima.ts hello\` and pass on what it says, unless its output is already in the conversation because a session-start hook ran it: then pass that on and do not run it again; when a naima command prints a NAIMA-MESSAGE line, tell the owner what it says at once, and never acknowledge a message for them; if you find Naima elsewhere, update this line.`
}

const textOf = (root: string, entryFile: string): string | null => {
  const path = join(root, entryFile)
  return existsSync(path) ? readFileSync(path, "utf8") : null
}

/** Whether `entryFile` already says where Naima is, or links Naima's agent docs as an earlier pointer did. */
function hasPointer(root: string, entryFile: string): boolean {
  const text = textOf(root, entryFile)
  if (text === null) return false
  return text.includes(POINTER_MARK) || linksIn(text).some((raw) => /(^|\/)naima\/docs\/agents\/README\.md$/.test(localTarget(raw) ?? ""))
}

/** Whether `entryFile` holds the pointer line as it reads now: an earlier wording, or a tracker folder since moved, is not. */
const isCurrent = (root: string, tracker: string, entryFile: string): boolean => (textOf(root, entryFile) ?? "").includes(pointerLine(root, tracker))

export interface EntryPointer {
  /** The entry file the pointer is in, or would be written into. */
  file: string
  line: string
  /** One of the entry files already has it. */
  present: boolean
  /** It reads as the line does now: it says to run naima hello, and names the tracker folder where it is. */
  current: boolean
}

/** The pointer: present when AGENTS.md or a configured entry file has it; else the file it would be written into. */
export function agentPointer(root: string, tracker: string, entryFiles: readonly string[]): EntryPointer {
  const line = pointerLine(root, tracker)
  const files = [...new Set([AGENTS_FILE, ...entryFiles])]
  const holder = files.find((f) => isCurrent(root, tracker, f)) ?? files.find((f) => hasPointer(root, f))
  if (holder) return { file: holder, line, present: true, current: isCurrent(root, tracker, holder) }
  return { file: files.find((f) => existsSync(join(root, f))) ?? AGENTS_FILE, line, present: false, current: false }
}

/** Append the pointer line to `entryFile`, under a blank line, creating the file when it does not exist. */
export function writePointer(root: string, tracker: string, entryFile: string): void {
  const path = join(root, entryFile)
  const text = existsSync(path) ? readFileSync(path, "utf8") : ""
  const line = pointerLine(root, tracker)
  writeFileSync(path, text + (text && !text.endsWith("\n") ? "\n" : "") + (text.trim() ? "\n" : "") + line + "\n")
}

/** Rewrite, in place, a pointer line of `entryFile` that does not say to run naima hello; whether it did. */
export function upgradePointer(root: string, tracker: string, entryFile: string): boolean {
  const text = textOf(root, entryFile)
  if (text === null || isCurrent(root, tracker, entryFile) || !text.includes(POINTER_MARK)) return false
  const line = pointerLine(root, tracker)
  writeFileSync(join(root, entryFile), text.split("\n").map((l) => (l.includes(POINTER_MARK) ? line : l)).join("\n"))
  return true
}
