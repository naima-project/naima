// Which plugins a project loads, and from where: every first-party plugin
// unless the project switches it off or replaces it, then every third-party
// plugin its `plugins` table adds.
//
// Code runs from three places, each pinned so that what runs is what the
// project reviewed: a path inside the program (the program is locked), a file
// in the project pinned by its sha256, or a module in a git repository pinned
// by commit, fetched once into the tracker folder. Never from a package, and
// never from the data. Every manifest says the contract it was written for,
// and every factory receives the plugin API with its own scope, so a plugin
// from outside the program needs no import of the core.

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import * as api from "./api.ts"
import { sourceRefusal } from "./config.ts"
import { writeFileAtomic } from "./files.ts"
import { mustGit, runGit } from "./git.ts"
import { DATA_FILE } from "./layout.ts"
import type { PluginApi } from "./api.ts"
import type { Config, Extension, FirstParty, Plugin, PluginConfig, PluginFactory, PluginSource, Severity } from "./types.ts"

export type { PluginSource } from "./types.ts"

/** The core's own entry in the table: it cannot be switched off or replaced, only its checks weighed. */
export const CORE = "core"

/** Where plugins pinned by git commit are fetched, under the tracker folder, ignored by git. */
export const FETCHED = "plugins"

/** Where a project's plugins can come from: the program, the project's own files, and the tracker folder they are fetched into. */
export interface Where {
  program: string
  root: string
  tracker: string
}

const inside = (base: string, path: string): boolean => {
  const rel = relative(base, path)
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}

const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex")

/** The tracker's .gitignore ignores the fetched plugins: they are code, fetched again from their pin, never committed. */
function ignoreFetched(tracker: string): void {
  const path = join(tracker, ".gitignore")
  const line = `/${FETCHED}/`
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l !== "") : []
  if (!lines.includes(line)) writeFileAtomic(path, [...lines, line].join("\n") + "\n")
}

/** A clone of `git` at exactly `commit`, in the tracker folder: fetched when it is not there yet, refused when it has local changes. */
function fetched(where: Where, name: string, git: string, commit: string): string {
  const dir = join(where.tracker, FETCHED, name)
  const at = () => runGit(dir, ["rev-parse", "HEAD"]).out.trim()
  // A clone made with --no-checkout has HEAD at the branch tip and no files: when the pin is that tip, it is checked out all the same.
  let fresh = false
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dirname(dir), { recursive: true })
    mustGit(where.tracker, "clone", "--quiet", "--no-checkout", "--", git, dir)
    ignoreFetched(where.tracker)
    fresh = true
  }
  if (fresh || at() !== commit) {
    if (!runGit(dir, ["cat-file", "-e", `${commit}^{commit}`]).ok) mustGit(dir, "fetch", "--quiet", "origin")
    if (!runGit(dir, ["cat-file", "-e", `${commit}^{commit}`]).ok) throw new Error(`${DATA_FILE}: plugins.${name}: ${git} has no commit ${commit}`)
    mustGit(dir, "-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", commit)
  }
  if (runGit(dir, ["status", "--porcelain"]).out.trim()) {
    throw new Error(
      `${DATA_FILE}: plugins.${name}: ${dir} has local changes — what runs must be the pinned commit; remove the directory, and it is fetched again`,
    )
  }
  return dir
}

/** The module file a source names, checked against its pin. */
function moduleOf(where: Where, source: PluginSource, name: string): string {
  const entry = `${DATA_FILE}: plugins.${name}`
  if (typeof source === "string") {
    const path = resolve(where.program, source)
    if (isAbsolute(source) || !inside(where.program, path)) {
      throw new Error(`${entry}: ${source} is not a path inside the program — name a file of the project pinned by its sha256, or a git commit, instead`)
    }
    return path
  }
  if ("sha256" in source) {
    const path = resolve(where.root, source.path)
    if (isAbsolute(source.path) || !inside(where.root, path)) throw new Error(`${entry}: ${source.path} is not a path inside the project`)
    if (!existsSync(path)) throw new Error(`${entry}: ${source.path} does not exist`)
    const actual = sha256(path)
    if (actual !== source.sha256) {
      throw new Error(
        `${entry}: ${source.path} has changed since it was pinned: its sha256 is ${actual}, not ${source.sha256} — review it, then pin the new hash`,
      )
    }
    return path
  }
  const refusal = sourceRefusal(source.git)
  if (refusal) throw new Error(`${entry}: git ${refusal}`)
  const dir = fetched(where, name, source.git, source.commit)
  const path = resolve(dir, source.path)
  if (isAbsolute(source.path) || !inside(dir, path)) throw new Error(`${entry}: ${source.path} is not a path inside ${source.git}`)
  return path
}

/**
 * A module of another commit of Naima, by its path: what `naima update` reads of the commit it would move to
 * (core/updates.ts). The one other computed import of the core, and it too only loads a path on this disk.
 */
export const importFile = (path: string): Promise<Record<string, unknown>> => import(pathToFileURL(path).href)

/** A module's default-exported factory, from where its source says, as pinned. */
async function factoryAt(where: Where, source: PluginSource, name: string): Promise<PluginFactory> {
  const url = pathToFileURL(moduleOf(where, source, name)).href
  const mod = (await import(url)) as { default?: unknown }
  if (typeof mod.default !== "function") throw new Error(`${DATA_FILE}: plugins.${name}: its module has no default-exported factory`)
  const factory = mod.default as PluginFactory
  // A folder the manifest names is read from beside its module, unless it says otherwise.
  return (options, scope) => {
    const manifest = factory(options, scope)
    return manifest && typeof manifest === "object" && manifest.home === undefined ? { ...manifest, home: url } : manifest
  }
}

/**
 * What the factory of the plugin named `plugin` receives: the plugin API —
 * every function a plugin may use, and no other — its own name, and the names
 * its contributions go by. Frozen: a plugin cannot change what another gets.
 */
export function apiFor(plugin: string, config: Pick<Config, "rename">): PluginApi {
  const { CONTRACT, OLDEST_CONTRACT: _oldest, ...functions } = api
  return Object.freeze({
    ...functions,
    contract: CONTRACT,
    plugin,
    name: (kind: string, declared: string) => config.rename[kind]?.[`${plugin}/${declared}`] ?? declared,
  })
}

/** Why a manifest's contract is not one this core reads, or null: one written for a newer core is refused, not run against an API it does not know. */
export function contractRefusal(manifest: Plugin): string | null {
  const contract = manifest.contract ?? 1
  if (!Number.isInteger(contract)) return `says contract ${JSON.stringify(manifest.contract)}, which is not a contract version`
  if (contract > api.CONTRACT) return `is written for contract ${contract}, and this Naima speaks ${api.CONTRACT} — update Naima to run it`
  if (contract < api.OLDEST_CONTRACT) return `is written for contract ${contract}, older than the oldest this Naima reads, ${api.OLDEST_CONTRACT}`
  return null
}

/** The plugin a factory makes for `entry`, under the name the project gives it: its contributions are that name's. */
function make(name: string, factory: PluginFactory, entry: PluginConfig | undefined, config: Pick<Config, "rename">): Plugin {
  const manifest = factory(entry?.options ?? {}, apiFor(name, config))
  const refusal = contractRefusal(manifest)
  if (refusal) throw new Error(`plugin "${name}" ${refusal}`)
  return manifest.name === name ? manifest : { ...manifest, name }
}

/**
 * Every plugin `config` loads, in load order: the first-party ones in their
 * order — each as it is, switched off, or replaced by the module its
 * `replacedBy` names; one that is opt-in only when the table names it — then the third-party ones in the table's order.
 */
export async function composePlugins(
  where: Where,
  config: Pick<Config, "plugins" | "rename" | "extends">,
  firstParty: readonly FirstParty[],
): Promise<Plugin[]> {
  const out: Plugin[] = []
  const known = new Set(firstParty.map((p) => p.name))
  for (const { name, factory, optIn } of firstParty) {
    const entry = config.plugins[name]
    if (optIn && !entry) continue
    if (entry?.source !== undefined) {
      throw new Error(
        `${DATA_FILE}: plugins.${name} is first-party and already loaded — replacedBy runs other code under its name; source is for a third-party plugin`,
      )
    }
    if (entry?.enabled === false) continue
    out.push(make(name, entry?.replacedBy !== undefined ? await factoryAt(where, entry.replacedBy, name) : factory, entry, config))
  }
  for (const [name, entry] of Object.entries(config.plugins)) {
    if (known.has(name)) continue
    if (name === CORE) {
      if (!entry.enabled || entry.source || entry.replacedBy || Object.keys(entry.options).length) {
        throw new Error(`${DATA_FILE}: plugins.${CORE} is the core: it is always loaded as it is, and only its checks can be weighed`)
      }
      continue
    }
    if (entry.replacedBy !== undefined) {
      throw new Error(`${DATA_FILE}: plugins.${name}: replacedBy replaces a first-party plugin, and ${name} is none — name its code in source`)
    }
    if (entry.source === undefined) {
      throw new Error(`${DATA_FILE}: plugins.${name} is no first-party plugin and names no source — first-party: ${[...known].join(", ")}`)
    }
    if (!entry.enabled) continue
    out.push(make(name, await factoryAt(where, entry.source, name), entry, config))
  }
  if (config.extends.length) out.push(projectExtensions(config.extends))
  return out
}

/** The name the project's own extensions go by, as if a plugin had contributed them. */
export const PROJECT = "project"

/** naima.json's `extends`, contributed as a plugin named `project` contributes: additive, validated, documented like any. */
const projectExtensions = (extensions: Extension[]): Plugin => ({
  name: PROJECT,
  says: `the project's own extensions of the loaded plugins' types and fields, from ${DATA_FILE}`,
  contract: api.CONTRACT,
  extends: extensions,
})

/** The severity the project gives each plugin's checks: plugin name → check name → severity. */
export const severitiesOf = (config: Pick<Config, "plugins">): Record<string, Record<string, Severity>> =>
  Object.fromEntries(Object.entries(config.plugins).map(([name, e]) => [name, e.checks]))
