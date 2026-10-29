// The project file, `naima-data/naima.json`.
//
// Automatic first: every first-party plugin is loaded, with defaults it infers
// from the repository, unless the project says otherwise. The file holds only
// what the tool cannot infer — the data formats, the lock (which Naima runs:
// its source and commit), where the program is when it has
// moved — and the `plugins` table: a plugin's options, a plugin switched off
// or replaced, a third-party plugin added, a check weighed differently. The
// format is specified in docs/reference/format.md.

import { readFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { ADAPTERS } from "./adapters/index.ts"
import { message } from "./errors.ts"
import { writeFileAtomic } from "./files.ts"
import { DATA_FILE, DEFAULT_PROGRAM } from "./layout.ts"
import { FORMAT, formatRefusal, formatsOf } from "./format.ts"
import { DEFAULT_ENTRY_FILES } from "./pointer.ts"
import type { Config, Extension, PluginConfig, PluginOptions, PluginSource, Severity } from "./types.ts"

const CORE_KEYS = [
  "format",
  "formats",
  "source",
  "commit",
  "version",
  "sha256",
  "verify",
  "program",
  "plugins",
  "rename",
  "extends",
  "agents",
  "entryFiles",
  "updates",
]
/** Every key naima.json may hold: the core's, and the owner's answers about the tracker's remotes (core/exposure.ts). */
const KEYS = new Set([...CORE_KEYS, "privateRemotes"])
const COMMIT = /^[0-9a-f]{40}$/

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

export type Lock = Pick<Config, "source" | "commit" | "version" | "sha256" | "verify" | "program">

/**
 * Why a naima.json's `carry`, which data before format 3 may hold, keeps the
 * program from being a git clone, or null. The gitignored copy ("copy", or
 * its earlier name "clone") becomes the clone by itself; a program committed
 * in the project, vendored or as a submodule, is removed by hand first.
 */
export function carryRefusal(raw: Record<string, unknown>, program = "naima-tracker/naima"): string | null {
  const carry = raw["carry"]
  if (carry === undefined || carry === "copy" || carry === "clone") return null
  const how = carry === "submodule"
    ? `git submodule deinit -f ${program} && git rm -f ${program}`
    : carry === "vendored"
    ? `git rm -r -q --cached ${program} && rm -rf ${program}`
    : `remove ${program}`
  return `${DATA_FILE} says carry: ${
    JSON.stringify(carry)
  }, a program committed in the project, and the program is now a gitignored git clone — remove it by hand: ${how}, delete "carry" from ${DATA_FILE}, add /naima/ to the tracker folder's .gitignore, commit, then run the installer again`
}

/** A source on this disk rather than behind a URL. */
export const isLocalSource = (source: string): boolean => source.startsWith("file:") || !/^([a-z][a-z0-9+.-]*:\/\/|[^/\\\s]+@[^:/\\\s]+:)/i.test(source)

/**
 * Why `source` cannot be a lock's source, or null. It is handed to git as an
 * argument, so it never starts with "-" (git would read it as an option); a
 * path on this disk is absolute, or it would resolve against whatever
 * directory git happens to run in.
 */
export function sourceRefusal(source: string): string | null {
  if (source.startsWith("-")) return 'must not start with "-": git would read it as an option'
  if (isLocalSource(source) && !source.startsWith("file:") && !isAbsolute(source)) {
    return "a path on this disk must be absolute: a relative one resolves against wherever git runs"
  }
  return null
}

/**
 * The lock: which Naima runs the project, and where it is. The same keys in
 * every format, so that a Naima can be aligned, and can update, whatever the
 * format of the data it is about to read.
 */
export function parseLock(raw: Record<string, unknown>): Lock {
  const { source, commit } = raw
  if (typeof source !== "string" || !source.trim()) {
    throw new Error(`${DATA_FILE}: source must be the git URL (or absolute path) of the Naima this project runs`)
  }
  const refusal = sourceRefusal(source)
  if (refusal) throw new Error(`${DATA_FILE}: source ${refusal}`)
  if (typeof commit !== "string" || !COMMIT.test(commit)) throw new Error(`${DATA_FILE}: commit must be the full hash of the Naima commit this project runs`)
  const program = raw["program"] ?? DEFAULT_PROGRAM
  if (typeof program !== "string" || !program.trim()) throw new Error(`${DATA_FILE}: program must be a path, relative to the data directory`)
  const verify = raw["verify"]
  if (verify !== undefined && verify !== "signed") throw new Error(`${DATA_FILE}: verify is "signed", or absent`)
  const { version, sha256 } = raw
  if ((version === undefined) !== (sha256 === undefined)) {
    throw new Error(`${DATA_FILE}: version and sha256 go together: the release the commit is, and its archive's checksum`)
  }
  if (version !== undefined && (typeof version !== "string" || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version))) {
    throw new Error(`${DATA_FILE}: version must be the release's version, such as 1.2.0, without the v`)
  }
  if (sha256 !== undefined && (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256))) {
    throw new Error(`${DATA_FILE}: sha256 must be the SHA-256 of the release's archive, 64 hex digits`)
  }
  return {
    source,
    commit,
    ...(typeof version === "string" && typeof sha256 === "string" ? { version, sha256 } : {}),
    ...(verify ? { verify } : {}),
    program,
  }
}

/**
 * The contents of a naima.json in the format this Naima reads. Throws with the
 * reason when it is not one. `lenient` reads a naima.json whose core shape is
 * current but which still owes a plugin's migration: its format and any key a
 * plugin's migration will move are not held — only to load the plugins whose
 * migrations it owes.
 */
export function parseConfig(raw: unknown, opts: { lenient?: boolean } = {}): Config {
  if (!isObject(raw)) throw new Error(`${DATA_FILE} must hold a JSON object`)
  const refusal = formatRefusal(raw["format"])
  if (refusal && !opts.lenient) throw new Error(`${DATA_FILE} ${refusal}`)
  for (const key of Object.keys(raw)) {
    if (!KEYS.has(key) && !opts.lenient) {
      throw new Error(`${DATA_FILE}: unknown key "${key}" — it holds only ${[...KEYS].join(", ")}; everything else is inferred`)
    }
  }
  const lock = parseLock(raw)
  parsePrivateRemotes(raw["privateRemotes"])
  const extensions = raw["extends"] ?? []
  if (!Array.isArray(extensions) || !extensions.every(isObject)) {
    throw new Error(
      `${DATA_FILE}: extends is a list of extensions: { "type", "statuses", "traits", "transitions" } or { "field", "values", "appliesTo", "traits" }`,
    )
  }
  return {
    format: FORMAT,
    formats: formatsOf(raw),
    ...lock,
    plugins: parsePlugins(raw["plugins"]),
    rename: parseRename(raw["rename"]),
    extends: extensions as Extension[],
    entryFiles: parseEntryFiles(raw["entryFiles"]),
    ...(raw["agents"] === undefined ? {} : { agents: parseAgents(raw["agents"]) }),
    updates: parseUpdates(raw["updates"]),
  }
}

/**
 * `privateRemotes`: the remotes the owner said are private when their visibility cannot be told, each by its key —
 * 16 hex digits of a hash of its address, never the address (core/exposure.ts).
 */
function parsePrivateRemotes(value: unknown): void {
  if (value === undefined) return
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && /^[0-9a-f]{16}$/.test(v))) {
    throw new Error(`${DATA_FILE}: privateRemotes is a list of remote keys, 16 hex digits each, that naima init --remote-private records`)
  }
}

/** What a session start does about a newer Naima (`naima hello`): nothing, say it, or say what it changes and offer it. */
export const UPDATE_POLICIES = ["off", "check", "update"] as const
export type UpdatePolicy = (typeof UPDATE_POLICIES)[number]
/** Absent, a session start checks: it only reads the source, and changes nothing. */
export const DEFAULT_UPDATE_POLICY: UpdatePolicy = "check"

/** `updates`: off, check or update; absent, the default. */
export function parseUpdates(value: unknown): UpdatePolicy {
  if (value === undefined) return DEFAULT_UPDATE_POLICY
  if (typeof value !== "string" || !(UPDATE_POLICIES as readonly string[]).includes(value)) {
    throw new Error(`${DATA_FILE}: updates is ${UPDATE_POLICIES.join(", ")} — what a session start does about a newer Naima`)
  }
  return value as UpdatePolicy
}

/** `entryFiles`: the agent-harness entry files `check` and `init` act on, project root relative. Absent: sensible defaults. */
function parseEntryFiles(value: unknown): string[] {
  if (value === undefined) return [...DEFAULT_ENTRY_FILES]
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && v.trim())) {
    throw new Error(`${DATA_FILE}: entryFiles must be a list of paths, project-root relative`)
  }
  return value as string[]
}

/** `agents`: the agent tools the project uses, by their adapter's id; absent, those whose files the project holds and the one Naima runs inside. */
function parseAgents(value: unknown): string[] {
  const known = ADAPTERS.map((a) => a.id)
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && known.includes(v))) {
    throw new Error(`${DATA_FILE}: agents is a list of the agent tools the project uses, each one of ${known.join(", ")}`)
  }
  return [...new Set(value as string[])]
}

/** The `rename` table: kind → qualified id → new short name. Which ids exist is the registry's to say. */
function parseRename(value: unknown): Record<string, Record<string, string>> {
  if (value === undefined) return {}
  const shape = `${DATA_FILE}: rename maps a kind to { "<plugin>/<name>": "<new name>" }`
  if (!isObject(value)) throw new Error(shape)
  for (const table of Object.values(value)) {
    if (!isObject(table) || !Object.values(table).every((v) => typeof v === "string")) throw new Error(shape)
  }
  return value as Record<string, Record<string, string>>
}

const ENTRY_KEYS = new Set(["enabled", "options", "source", "replacedBy", "checks"])
const SEVERITIES = new Set<string>(["off", "note", "problem"])
/** A plugin's name: what its contributions' qualified ids start with. */
export const PLUGIN_NAME = /^[a-z][a-z0-9-]*$/

const SHA256 = /^[0-9a-f]{64}$/
const COMMIT_HASH = /^[0-9a-f]{40}$/

/**
 * Why `v` is not where a plugin's code is, or null: a path inside the
 * program; `{ "path", "sha256" }`, a file of the project pinned by its hash;
 * or `{ "git", "commit", "path" }`, a module of a repository pinned by commit.
 */
function sourceShape(v: unknown): string | null {
  const shapes = 'is a path inside the program, { "path", "sha256" } — a file of the project and its hash — or { "git", "commit", "path" }'
  if (typeof v === "string") return v.trim() ? null : shapes
  if (!isObject(v)) return shapes
  const keys = Object.keys(v).sort().join(",")
  if (keys === "path,sha256") {
    if (typeof v["path"] !== "string" || !v["path"].trim()) return "path must name a file of the project"
    return typeof v["sha256"] === "string" && SHA256.test(v["sha256"]) ? null : "sha256 must be the file's sha256, 64 hex digits"
  }
  if (keys === "commit,git,path") {
    if (typeof v["git"] !== "string" || !v["git"].trim()) return "git must be the URL, or absolute path, of the plugin's repository"
    const refusal = sourceRefusal(v["git"])
    if (refusal) return `git ${refusal}`
    if (typeof v["commit"] !== "string" || !COMMIT_HASH.test(v["commit"])) return "commit must be the full hash of the commit it runs"
    return typeof v["path"] === "string" && v["path"].trim() ? null : "path must name the module inside the repository"
  }
  return shapes
}

/** The `plugins` table: plugin name → its configuration. Which names are first-party is the loader's to say. */
function parsePlugins(value: unknown): Record<string, PluginConfig> {
  if (value === undefined) return {}
  if (!isObject(value)) {
    throw new Error(`${DATA_FILE}: plugins maps a plugin's name to its configuration: { "options", "enabled", "source", "replacedBy", "checks" }`)
  }
  const out: Record<string, PluginConfig> = {}
  for (const [name, entry] of Object.entries(value)) {
    const where = `${DATA_FILE}: plugins.${name}`
    if (!PLUGIN_NAME.test(name)) throw new Error(`${where}: a plugin's name is lowercase letters, digits and dashes, starting with a letter`)
    if (!isObject(entry)) throw new Error(`${where} must be an object: { "options", "enabled", "source", "replacedBy", "checks" }`)
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.has(key)) throw new Error(`${where}: unknown key "${key}" — an entry holds ${[...ENTRY_KEYS].join(", ")}`)
    }
    const { enabled = true, options = {}, source, replacedBy, checks = {} } = entry
    if (typeof enabled !== "boolean") throw new Error(`${where}.enabled must be true or false`)
    if (!isObject(options)) throw new Error(`${where}.options must be an object`)
    for (const [key, v] of [["source", source], ["replacedBy", replacedBy]] as const) {
      const why = v === undefined ? null : sourceShape(v)
      if (why) throw new Error(`${where}.${key} ${why}`)
    }
    if (source !== undefined && replacedBy !== undefined) {
      throw new Error(`${where}: source is a third-party plugin's, replacedBy a first-party one's — not both`)
    }
    if (!isObject(checks)) throw new Error(`${where}.checks maps a check's name to off, note or problem`)
    for (const [check, level] of Object.entries(checks)) {
      if (typeof level !== "string" || !SEVERITIES.has(level)) throw new Error(`${where}.checks.${check} must be off, note or problem`)
    }
    out[name] = {
      enabled,
      options: options as PluginOptions,
      ...(source !== undefined ? { source: source as PluginSource } : {}),
      ...(replacedBy !== undefined ? { replacedBy: replacedBy as PluginSource } : {}),
      checks: checks as Record<string, Severity>,
    }
  }
  return out
}

/** The raw JSON of `<data>/naima.json`. */
export function readRaw(data: string): Record<string, unknown> {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(data, DATA_FILE), "utf8"))
  } catch (e) {
    throw new Error(`${DATA_FILE}: ${message(e)}`)
  }
  if (!isObject(raw)) throw new Error(`${DATA_FILE} must hold a JSON object`)
  return raw
}

export const readConfig = (data: string): Config => parseConfig(readRaw(data))

/** Write `<data>/naima.json`, keys in the order given. */
export function writeRaw(data: string, raw: Record<string, unknown>): void {
  writeFileAtomic(join(data, DATA_FILE), JSON.stringify(raw, null, 2) + "\n")
}

/**
 * Write `<data>/naima.json`, refused instead when `raw` as a whole is not a
 * config this core reads — the same check every load makes — so a command
 * that edits the file by hand, such as `naima plugin`, never writes what the
 * next load would refuse. Returns the config it validated.
 */
export function writeValidatedRaw(data: string, raw: Record<string, unknown>): Config {
  const config = parseConfig(raw)
  writeRaw(data, raw)
  return config
}

/**
 * The program directory `<data>/naima.json` names, or the default one when the
 * file cannot be read — the program then reports what is wrong with it. For
 * the launcher, which must know where the program is before anything runs.
 */
export function programOf(data: string): string {
  try {
    const raw = readRaw(data)
    return resolve(data, typeof raw["program"] === "string" ? raw["program"] : DEFAULT_PROGRAM)
  } catch {
    return resolve(data, DEFAULT_PROGRAM)
  }
}

/** The absolute program directory of a project whose data is `data`. */
export const programDir = (data: string, config: Pick<Config, "program">): string => resolve(data, config.program)

/** A path from `from` to `to`, with forward slashes: for messages, and for git. */
export const posixRelative = (from: string, to: string): string => relative(from, to).split(sep).join("/")
