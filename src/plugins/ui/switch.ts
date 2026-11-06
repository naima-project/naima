// The UI's switcher of recent projects: the projects Naima knows on this machine, the most recently opened first
// (core/projects.ts, the list the "All projects" screen reads too), and the switch to one of them. The page asks the
// bridge's `recent` for the list and `switch` to move to one. In a browser `naima ui` writes the project chosen in the
// file its launcher named (NAIMA_UI_SWITCH), answers, stops, and exits with UI_SWITCH: the launcher then serves that
// project on the same address with the same token, so the page finds it there and reloads. On the desktop the shell
// restarts its sidecar in the chosen project itself; the sidecar only gives the list.

import { writeFileSync } from "node:fs"
import { basename, resolve } from "node:path"
import process from "node:process"
import { type KnownProject, knownProjects, UI_SWITCH_ENV, type UiSwitch } from "../../core/projects.ts"

export interface RecentProject {
  name: string
  root: string
  /** The project the UI shows now. */
  here: boolean
}

/** The recent projects, the most recently opened first, each marked whether it is the one at `root`. */
export function recentProjects(root: string, known: readonly KnownProject[] = knownProjects()): RecentProject[] {
  const here = resolve(root)
  return known.map((p) => ({ name: basename(p.root), root: p.root, here: resolve(p.root) === here }))
}

/** The project of `known` at `root`, when it is one of them. */
export function knownAt(root: string, known: readonly KnownProject[] = knownProjects()): KnownProject | null {
  return known.find((p) => resolve(p.root) === resolve(root)) ?? null
}

type Permissions = { querySync?(d: { name: "write"; path: string }): { state: string } }

/**
 * The file a switch is written to, when this run may write it: the launcher names it and grants writing it alone;
 * the permission is asked first, so that a run without it (started some other way) offers no switch.
 */
export function switchFile(env: Record<string, string | undefined> = process.env): string | null {
  const file = env[UI_SWITCH_ENV.file]
  if (!file) return null
  const perms = (globalThis as { Deno?: { permissions?: Permissions } }).Deno?.permissions
  if (!perms?.querySync) return file
  try {
    return perms.querySync({ name: "write", path: file }).state === "granted" ? file : null
  } catch {
    return null
  }
}

/** Write the switch for the launcher: the project to serve next, and the address to keep. */
export function writeSwitch(file: string, to: UiSwitch): void {
  writeFileSync(file, JSON.stringify(to) + "\n")
}

/** The address a run that switched keeps, from its launcher: null for a run started afresh. */
export function resumed(env: Record<string, string | undefined> = process.env): { port: number; token: string } | null {
  const port = Number(env[UI_SWITCH_ENV.port])
  const token = env[UI_SWITCH_ENV.token]
  return token && Number.isInteger(port) && port > 0 && port < 65536 ? { port, token } : null
}
