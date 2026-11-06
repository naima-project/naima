// The projects Naima knows on this machine, the most recently opened first: `projects.json` in the user's standard
// config folder (projectsDir), outside every repository, a JSON array of { root, data }: each project's checkout and
// its tracker's data folder. The launcher puts the project it runs in first whenever `naima ui` starts there, the
// desktop app's sidecar included, and drops from the file every project whose folder is gone; it hands the list to the
// program in NAIMA_PROJECTS, since the program may not read the user's config itself. The UI's home across projects
// reads it (plugins/ui/projects.ts), and so does its switcher of recent projects (plugins/ui/switch.ts).

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
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

/**
 * The user's standard config folder for Naima, by operating system: `~/Library/Application Support/Naima` on macOS,
 * `%APPDATA%\Naima` on Windows, `$XDG_CONFIG_HOME/naima`, else `~/.config/naima`, elsewhere.
 */
export function projectsDir(env: Record<string, string | undefined>, os: string): string {
  const home = env["HOME"] || env["USERPROFILE"] || safeHome()
  if (os === "darwin" && home) return join(home, "Library", "Application Support", "Naima")
  if (os === "windows" && env["APPDATA"]) return join(env["APPDATA"], "Naima")
  return userConfigDir(env, os)
}

function safeHome(): string | undefined {
  try {
    return homedir() || undefined
  } catch {
    return undefined
  }
}

/** Where the list is kept: `projects.json` in the user's standard config folder (projectsDir). */
export const projectsFile = (env: Record<string, string | undefined>, os: string): string => join(projectsDir(env, os), "projects.json")

/** Where the list was kept before, the folder of Naima's private lists (core/private.ts): read while the standard file is not there yet. */
export const formerProjectsFile = (env: Record<string, string | undefined>, os: string): string => join(userConfigDir(env, os), "projects.json")

/** The list's text: the standard file's, else the former file's, else null. */
function listText(env: Record<string, string | undefined>, os: string): string | null {
  return readText(projectsFile(env, os)) ?? readText(formerProjectsFile(env, os))
}

/** Whether a project's folders are both there. */
function present(p: KnownProject): boolean {
  try {
    return existsSync(p.root) && existsSync(p.data)
  } catch {
    return false
  }
}

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

/** The list with `p` first, the most recently opened, once, with its data folder as given now. */
export function remember(list: readonly KnownProject[], p: KnownProject): KnownProject[] {
  const at = { root: resolve(p.root), data: resolve(p.data) }
  return [at, ...list.filter((o) => o.root !== at.root)]
}

/** Put `p` first in the file, drop every project whose folders are gone, and return the list; the list without writing when the file cannot be written. */
export function rememberProject(env: Record<string, string | undefined>, os: string, p: KnownProject): KnownProject[] {
  const file = projectsFile(env, os)
  const before = parseProjects(readText(file))
  const list = remember(parseProjects(listText(env, os)), p).filter((o, i) => i === 0 || present(o))
  if (JSON.stringify(list) !== JSON.stringify(before)) {
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(list, null, 2) + "\n")
    } catch { /* the list still holds this project for this run */ }
  }
  return list
}

/** The projects known, the most recently opened first, from the launcher's variable, else the file; only those whose folders are there. */
export function knownProjects(
  env: Record<string, string | undefined> = process.env,
  os: string = process.platform === "win32" ? "windows" : process.platform,
): KnownProject[] {
  const given = env[PROJECTS_ENV]
  return parseProjects(given !== undefined ? given : listText(env, os)).filter(present)
}

/**
 * The exit code with which `naima ui` asks its launcher to serve another project of the list, on the same address
 * with the same token, so that the page that asked finds it there: the file NAIMA_UI_SWITCH names says which.
 */
export const UI_SWITCH = 76

/** The variables of a switch: the file the program writes the project to switch to in, and the address the next run keeps. */
export const UI_SWITCH_ENV = { file: "NAIMA_UI_SWITCH", port: "NAIMA_UI_PORT", token: "NAIMA_UI_TOKEN" } as const

/** Where `naima ui` is asked to serve next: the project's root, the port it listens on and the run's token. */
export interface UiSwitch {
  root: string
  port: number
  token: string
}

/** The project a switch file's text names, with the address to keep: null unless it is one of `known`, with a port and a token. */
export function switchTarget(text: string | null, known: readonly KnownProject[]): (KnownProject & UiSwitch) | null {
  let raw: Partial<UiSwitch> | null
  try {
    raw = text ? JSON.parse(text) : null
  } catch {
    return null
  }
  if (!raw || typeof raw.root !== "string" || typeof raw.token !== "string" || !/^[0-9a-f]{16,128}$/.test(raw.token)) return null
  const port = raw.port
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return null
  const at = known.find((p) => resolve(p.root) === resolve(raw!.root!))
  return at ? { root: at.root, data: at.data, port, token: raw.token } : null
}
