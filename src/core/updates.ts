// What moving the lock changes, said before it moves: the commits, the data
// formats, the rules page, and the options the other commit no longer reads. And
// what a session starts with: the banner `naima hello` prints
// (docs/guide/update-naima.md).
//
// The other commit is read, not run in place of this one: its files are
// checked out from the program's own git into a folder inside the program's
// .git, its manifests imported from there under the same permissions, and the
// folder removed. Nothing in the project, nor the program's checkout, changes.

import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { message } from "./errors.ts"
import { FORMAT } from "./format.ts"
import { importFile } from "./plugins.ts"
import { runGit } from "./git.ts"
import { short } from "./program.ts"
import type { FirstParty, Plugin } from "./types.ts"

/** `n` of `noun`, its plural made with an s. */
export const counted = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`

/** The version `commit` is: the nearest tag v<x.y.z> at or before it, and how many commits past it. */
export function versionOf(repo: string, commit: string): string {
  const r = runGit(repo, ["describe", "--tags", "--long", "--match", "v[0-9]*", commit])
  const m = r.ok ? /^v(.+)-(\d+)-g[0-9a-f]+$/.exec(r.out) : null
  if (!m) return "an untagged version"
  const past = Number(m[2])
  return past === 0 ? `version ${m[1]}` : `version ${m[1]} and ${counted(past, "commit")} after it`
}

/** The line every session starts with. */
export const banner = (version: string, commit: string): string => `Naima is active in this repository: ${version}, commit ${short(commit)}.`

/** What an agent offers after the banner. */
export const OFFERS =
  "On request: what Naima is and its documentation (naima guide); whether a newer Naima exists (naima update --check); an update (naima update), only after the owner's yes."

/** The plugins table, as naima.json holds it. */
type Table = Record<string, { options?: unknown; source?: unknown; replacedBy?: unknown } | undefined>

/** What is known of a plugin's options: its name, and the options it declares (undefined: it does not say). */
export interface Declares {
  name: string
  options?: readonly { name: string }[] | undefined
}

/**
 * The options `table` sets that no plugin of `plugins` reads, as `plugins.<name>.options.<key>`: a key its
 * plugin does not declare, or every key of a first-party name no plugin has. A plugin that declares no
 * options list, and a third-party one not in `plugins`, are not judged.
 */
export function unreadOptions(table: Table, plugins: readonly Declares[], judgeMissing = false): { plugin: string; key: string; path: string }[] {
  const out: { plugin: string; key: string; path: string }[] = []
  const at = (plugin: string, key: string) => ({ plugin, key, path: `plugins.${plugin}.options.${key}` })
  for (const [name, entry] of Object.entries(table)) {
    if (name === "core" || !entry || typeof entry.options !== "object" || entry.options === null) continue
    const keys = Object.keys(entry.options)
    const p = plugins.find((x) => x.name === name)
    if (!p) {
      if (judgeMissing && entry.source === undefined) out.push(...keys.map((k) => at(name, k)))
      continue
    }
    if (!p.options) continue
    const declared = new Set(p.options.map((o) => o.name))
    out.push(...keys.filter((k) => !declared.has(k)).map((k) => at(name, k)))
  }
  return out
}

/** One format that changes: the core's (`plugin` null) or a plugin's. */
export interface FormatChange {
  plugin: string | null
  from: number
  to: number
}

/** What moving the lock from `from` to `to` changes. */
export interface Change {
  from: string
  to: string
  /** `to` is behind `from`: the commits listed are undone. */
  back: boolean
  /** Their subjects, newest first. */
  commits: string[]
  /** The formats `to` reads that differ from the data's. */
  formats: FormatChange[]
  /** One line per rule added to or removed from the rules page. */
  rules: string[]
  /** The options naima.json sets that `to` reads nowhere. */
  unread: string[]
  /** `to`'s refusal of naima.json as it is, lock aside; null when it reads it, or when the formats differ and a migration will rewrite it. */
  config: string | null
  /** `to`'s refusal of naima.json without `updates`, an option older Naimas do not know; null when it reads it. */
  configWithoutUpdates: string | null
  /** Why `to`'s own code could not be read: then formats, unread options and config are unknown. */
  unknown: string | null
}

/** The data's formats: the core's, and each plugin's that has one. */
function formatsOf(raw: Record<string, unknown>): { core: number; plugins: Record<string, number> } {
  const f = raw["formats"]
  const plugins = f && typeof f === "object" && !Array.isArray(f) ? (f as Record<string, number>) : {}
  return { core: typeof raw["format"] === "number" ? raw["format"] : FORMAT, plugins }
}

/** The `### ` headings of a markdown page, outside fenced code: the rules page names one rule per heading. */
function headings(text: string | null): string[] {
  if (text === null) return []
  const out: string[] = []
  let fenced = false
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    else if (!fenced && line.startsWith("### ")) out.push(line.slice(4).trim())
  }
  return out
}

/** The rules that differ between two versions of the rules page, which names every rule, a plugin's too: added, removed, a line each. */
function ruleLines(before: string[], after: string[]): string[] {
  return [
    ...after.filter((h) => !before.includes(h)).map((h) => `rule added: ${h}`),
    ...before.filter((h) => !after.includes(h)).map((h) => `rule removed: ${h}`),
  ]
}

/** What another commit's own code says: its format, its first-party manifests, and whether it reads a naima.json. */
interface Read {
  format: number
  plugins: Plugin[]
  /** The format each of its plugins reads, by name: 1 + its migrations, counted by its own code. */
  reads: Map<string, number>
  parse: (raw: unknown) => unknown
}

/** Check `commit` out of `program`'s git into a folder of its .git, and import what it says of itself. The folder is removed after. */
async function readCommit(program: string, commit: string): Promise<Read> {
  const base = join(program, ".git", "naima-preview")
  const dir = join(base, commit)
  const env = { GIT_INDEX_FILE: join(base, `${commit}.index`) }
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  try {
    for (const args of [["read-tree", commit], ["checkout-index", "--all", "--force", `--prefix=${dir}/`]]) {
      const r = runGit(program, args, { env })
      if (!r.ok) throw new Error(`git ${args[0]}: ${r.err.split("\n")[0]}`)
    }
    // deno-lint-ignore no-explicit-any
    const load = (f: string) => importFile(join(dir, f)) as Promise<any>
    const [format, builtins, plugins, manifest, config] = await Promise.all([
      load("src/core/format.ts"),
      load("src/builtins.ts"),
      load("src/core/plugins.ts"),
      load("src/core/manifest.ts"),
      load("src/core/config.ts"),
    ])
    const firstParty = builtins.firstParty as FirstParty[]
    const made = firstParty.map((p) => p.factory({}, plugins.apiFor(p.name, { rename: {} })) as Plugin)
    const reads = new Map(made.map((p) => [p.name, 1 + (manifest.migrationsOf(p) as unknown[]).length]))
    return { format: format.FORMAT as number, plugins: made, reads, parse: config.parseConfig as (raw: unknown) => unknown }
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(env.GIT_INDEX_FILE, { force: true })
  }
}

const refusalOf = (parse: (raw: unknown) => unknown, raw: unknown): string | null => {
  try {
    parse(raw)
    return null
  } catch (e) {
    return message(e)
  }
}

/**
 * What moving the lock from `from` to `to` changes for a project whose naima.json is `raw`, both commits in
 * `program`'s git.
 */
export async function changeOf(program: string, raw: Record<string, unknown>, from: string, to: string): Promise<Change> {
  const back = runGit(program, ["merge-base", "--is-ancestor", to, from]).ok
  const log = runGit(program, ["log", "--format=%s", back ? `${to}..${from}` : `${from}..${to}`])
  const commits = log.ok ? log.out.split("\n").filter((l) => l) : []
  const page = (c: string) => {
    const r = runGit(program, ["show", `${c}:docs/guide/rules.md`])
    return r.ok ? r.out : null
  }
  const change: Change = {
    from,
    to,
    back,
    commits,
    formats: [],
    rules: [],
    unread: [],
    config: null,
    configWithoutUpdates: null,
    unknown: null,
  }
  let theirs: Read
  try {
    theirs = await readCommit(program, to)
  } catch (e) {
    change.unknown = message(e)
    change.rules = ruleLines(headings(page(from)), headings(page(to)))
    return change
  }
  const data = formatsOf(raw)
  if (theirs.format !== data.core) change.formats.push({ plugin: null, from: data.core, to: theirs.format })
  const reads = theirs.reads
  for (const name of new Set([...Object.keys(data.plugins), ...reads.keys()])) {
    const was = data.plugins[name] ?? 1
    const will = reads.get(name) ?? was
    if (was !== will) change.formats.push({ plugin: name, from: was, to: will })
  }
  change.rules = ruleLines(headings(page(from)), headings(page(to)))
  change.unread = unreadOptions((raw["plugins"] ?? {}) as Table, theirs.plugins, true).map((u) => u.path)
  if (!change.formats.length) {
    const lock = { ...raw, commit: to }
    change.config = refusalOf(theirs.parse, lock)
    if (change.config && "updates" in lock) {
      const { updates: _dropped, ...without } = lock
      change.configWithoutUpdates = refusalOf(theirs.parse, without)
    }
  }
  return change
}

/** A format change, said. */
const formatSaid = (f: FormatChange): string => `${f.plugin === null ? "data format" : `${f.plugin} format`} ${f.from} → ${f.to}`

/** Whether moving the lock would leave data newer than the commit reads: migrations run forward only. */
export const backwardFormats = (c: Change): FormatChange[] => c.formats.filter((f) => f.to < f.from)

/** What `c` changes, as lines: a heading, then each change indented. */
export function describe(c: Change, limit = 10): string[] {
  const n = c.commits.length
  const commits = `${counted(n, "commit")}${c.back ? " undone" : ""}`
  const out = [`What changes: ${short(c.from)} → ${short(c.to)}, ${commits}:`]
  for (const s of c.commits.slice(0, limit)) out.push(`  - ${s}`)
  if (n > limit) out.push(`  - and ${n - limit} more`)
  if (c.unknown) {
    out.push(`  formats, options: unknown — ${short(c.to)}'s own code could not be read (${c.unknown})`)
  } else if (!c.formats.length) out.push("  data format: unchanged")
  else {
    for (const f of c.formats) {
      out.push(
        `  ${formatSaid(f)}: ${
          f.to > f.from ? "a migration, which naima update runs in the same change" : "older than the data, which cannot be migrated back"
        }`,
      )
    }
  }
  out.push(...(c.rules.length ? c.rules.map((r) => `  ${r}`) : ["  rules: unchanged"]))
  if (c.unread.length) out.push(`  options no longer read: ${c.unread.join(", ")}`)
  return out
}
