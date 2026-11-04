// The projects Naima knows on this machine: `projects.json` in the user's Naima config folder (core/private.ts),
// outside every repository, a JSON array of { root, data }: each project's checkout and its tracker's data folder.
// The launcher adds the project it runs in whenever `naima ui` starts there, and hands the list to the program in
// NAIMA_PROJECTS, since the program may not read the user's config itself; the UI's home across projects reads it
// (plugins/ui/projects.ts). A project whose folder is gone is left out when read, and kept in the file.

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import process from "node:process"
import { readText, userConfigDir } from "./private.ts"

/** The variable the launcher hands the list in, as the file's JSON. */
export const PROJECTS_ENV = "NAIMA_PROJECTS"

export interface KnownProject {
  /** The project's checkout. */
  root: string
  /** Its tracker's data folder. */
  data: string
}

/** Where the list is kept: `$XDG_CONFIG_HOME/naima/projects.json`, else `~/.config/naima/projects.json`; on Windows `%APPDATA%\naima\projects.json`. */
export const projectsFile = (env: Record<string, string | undefined>, os: string): string => join(userConfigDir(env, os), "projects.json")

/** The projects a list's text names, each once, by its root; anything else in it is ignored. */
export function parseProjects(text: string | null): KnownProject[] {
  let raw: unknown
  try {
    raw = text ? JSON.parse(text) : []
  } catch {
    return []
  }
  const out: KnownProject[] = []
  for (const p of Array.isArray(raw) ? raw : []) {
    const r = p as Partial<KnownProject> | null
    if (r && typeof r.root === "string" && typeof r.data === "string" && !out.some((o) => o.root === r.root)) out.push({ root: r.root, data: r.data })
  }
  return out
}

/** The list with `p` in it: first when new, where it was otherwise, its data folder as given now. */
export function remember(list: readonly KnownProject[], p: KnownProject): KnownProject[] {
  const at = { root: resolve(p.root), data: resolve(p.data) }
  return list.some((o) => o.root === at.root) ? list.map((o) => (o.root === at.root ? at : o)) : [at, ...list]
}

/** Add `p` to the file and return the list; the list without writing when the file cannot be written. */
export function rememberProject(env: Record<string, string | undefined>, os: string, p: KnownProject): KnownProject[] {
  const file = projectsFile(env, os)
  const before = parseProjects(readText(file))
  const list = remember(before, p)
  if (JSON.stringify(list) !== JSON.stringify(before)) {
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(list, null, 2) + "\n")
    } catch { /* the list still holds this project for this run */ }
  }
  return list
}

/** The projects known, from the launcher's variable, else the file; only those whose folders are there. */
export function knownProjects(
  env: Record<string, string | undefined> = process.env,
  os: string = process.platform === "win32" ? "windows" : process.platform,
): KnownProject[] {
  const given = env[PROJECTS_ENV]
  const list = parseProjects(given !== undefined ? given : readText(projectsFile(env, os)))
  return list.filter((p) => {
    try {
      return existsSync(p.root) && existsSync(p.data)
    } catch {
      return false
    }
  })
}
