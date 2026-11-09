// Naima's UI opened at a session start: naima hello opens it on the project by itself — the desktop app when it is
// installed, else `naima ui` in the background, which opens the browser — and reuses a UI already open on the project
// instead of opening a second one. It never waits on what it starts and never fails hello: whatever goes wrong, it
// opens nothing and says nothing.
//
// The registry, in Naima's state folder of the clone (ui/<project>/), is a folder of records numbered by generation,
// each created only if absent (an exclusive create); the current record is the highest. A record names either a hello
// that is opening the UI (a claim, live while that process runs) or the UI it opened, or one opened by hand (live
// while that process runs): its process, how it shows (browser or desktop) and, in a browser, its address. A hello
// reads the current record: live, it reuses that UI; otherwise it creates the next generation, which fails when another
// created it first, and then reads again, once, before it gives up. With the claim made, it starts the UI and rewrites
// its record to name it. This follows the model develop/models/ui-at-start/ui-at-start.mcrl2 in the workshop, whose
// properties say that two hellos never leave two UIs open and that a hello always returns.
//
// It is off where nobody looks: on CI, with NAIMA_NO_UI set, in a worker's worktree (a linked worktree of the clone)
// or under NAIMA_DATA; and off by choice with the ui plugin's option atStart=false, or "atStart": false in the user's
// <config>/naima/ui.json.

import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { runGit, stateDir, userConfigDir } from "../../core/api.ts"
import { HOST, newToken } from "./serve.ts"

export { desktopAppDirs } from "./desktop.ts"

/** A record of the registry: the process that holds it, how its UI shows, and, in a browser, its address. */
export interface UiRecord {
  pid: number
  how: "claim" | "browser" | "desktop"
  url?: string
}

/** The registry's folder for the project at `root`, in the clone's state folder: null outside git. */
export function registryDir(root: string): string | null {
  const state = stateDir(root)
  return state ? join(state, "ui", createHash("sha256").update(root).digest("hex").slice(0, 16)) : null
}

const NAME = /^(\d+)\.json$/
const fileOf = (dir: string, gen: number): string => join(dir, `${String(gen).padStart(8, "0")}.json`)

/** The current record: the highest generation, its record null when it cannot be read; generation 0 when there is none. */
export function current(dir: string): { gen: number; rec: UiRecord | null } {
  let gen = 0
  try {
    for (const f of readdirSync(dir)) {
      const m = f.match(NAME)
      if (m) gen = Math.max(gen, Number(m[1]))
    }
  } catch {
    return { gen: 0, rec: null }
  }
  if (!gen) return { gen, rec: null }
  try {
    const r = JSON.parse(readFileSync(fileOf(dir, gen), "utf8")) as UiRecord
    return { gen, rec: Number.isInteger(r?.pid) ? r : null }
  } catch {
    return { gen, rec: null }
  }
}

/**
 * Whether the process `pid` runs: signal 0 tests it, and a process of another user still runs. Where signals are not
 * granted (naima hello, launched, may start only its few programs), ps, or tasklist on Windows, says.
 */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === "EPERM") return true
    if (code === "ESRCH") return false
  }
  const r = process.platform === "win32"
    ? spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { encoding: "utf8" })
    : spawnSync("ps", ["-p", String(pid)], { encoding: "utf8" })
  return process.platform === "win32" ? String(r.stdout ?? "").includes(` ${pid} `) : r.status === 0
}

/** Create generation `gen` holding `rec`, only if no one has: false when another created it first. */
export function create(dir: string, gen: number, rec: UiRecord): boolean {
  try {
    writeFileSync(fileOf(dir, gen), JSON.stringify(rec), { flag: "wx" })
    return true
  } catch {
    return false
  }
}

/** Rewrite generation `gen`, the holder's own, to name what it opened; then drop the generations before it. */
export function rewrite(dir: string, gen: number, rec: UiRecord): void {
  writeFileSync(fileOf(dir, gen), JSON.stringify(rec))
  for (const f of readdirSync(dir)) {
    const m = f.match(NAME)
    if (m && Number(m[1]) < gen) rmSync(join(dir, f), { force: true })
  }
}

/**
 * Claim the next generation for `rec`, unless a live record stands: the live one, or the generation claimed, or null
 * when another claimed first twice. What hello does before opening, and `naima ui` and its sidecar when they start.
 */
export function claim(dir: string, rec: UiRecord, alive: (pid: number) => boolean): { live: UiRecord } | { gen: number } | null {
  for (let attempt = 0; attempt < 2; attempt++) {
    const c = current(dir)
    if (c.rec && alive(c.rec.pid)) return { live: c.rec }
    if (create(dir, c.gen + 1, rec)) return { gen: c.gen + 1 }
  }
  return null
}

/** Register a UI this process serves, when none stands: its generation, or null. Never throws. */
export function register(root: string, rec: Omit<UiRecord, "pid">): { dir: string; gen: number } | null {
  try {
    const dir = registryDir(root)
    if (!dir) return null
    const c = current(dir)
    // Started by hello, which already named this process.
    if (c.rec?.pid === process.pid) {
      rewrite(dir, c.gen, { ...c.rec, ...rec, pid: process.pid })
      return { dir, gen: c.gen }
    }
    writeDirs(dir)
    const got = claim(dir, { ...rec, pid: process.pid }, processAlive)
    return got && "gen" in got ? { dir, gen: got.gen } : null
  } catch {
    return null
  }
}

/** Remove this process's record as it stops, when it still holds it. Never throws. */
export function unregister(at: { dir: string; gen: number } | null): void {
  if (!at) return
  try {
    const c = current(at.dir)
    if (c.gen === at.gen && c.rec?.pid === process.pid) rmSync(fileOf(at.dir, at.gen), { force: true })
  } catch {
    // left behind, it is stale once this process ends
  }
}

const writeDirs = (dir: string): void => void mkdirSync(dir, { recursive: true })

/** Why hello opens no UI here, or null when it may: CI, NAIMA_NO_UI, NAIMA_DATA, a worker's worktree, or the options. */
export function offReason(root: string, env: Record<string, string | undefined>, projectOn: boolean, userOn: boolean): string | null {
  if (env["NAIMA_NO_UI"]) return "NAIMA_NO_UI is set"
  if (env["CI"]) return "this is CI"
  if (env["NAIMA_DATA"]) return "NAIMA_DATA is set: an agent's run on another checkout's data"
  if (!projectOn) return "the ui plugin's option atStart is false"
  if (!userOn) return "the user's ui.json says atStart false"
  const r = runGit(root, ["rev-parse", "--git-dir", "--git-common-dir"])
  const [gitDir, common] = r.ok ? r.out.split("\n") : []
  if (gitDir && common && gitDir !== common) return "this is a worktree of the clone, not its main checkout"
  return null
}

/** Whether the user's config leaves opening at a session start on: `{"atStart": false}` in <config>/naima/ui.json turns it off. */
export function userAtStart(env: Record<string, string | undefined>, os: string): boolean {
  try {
    return (JSON.parse(readFileSync(join(userConfigDir(env, os), "ui.json"), "utf8")) as { atStart?: unknown }).atStart !== false
  } catch {
    return true
  }
}

/** The desktop app's program when it is installed, from `dirs` (desktopAppDirs): the program in the first that has one; null when none. */
export function desktopApp(dirs: readonly string[]): string | null {
  for (const macos of dirs) {
    try {
      const bin = readdirSync(macos).find((f) => !f.startsWith("."))
      if (bin) return join(macos, bin)
    } catch {
      // not there
    }
  }
  return null
}

/** What opening the UI does outside this module: each replaced by a test. */
export interface AtStartDeps {
  alive(pid: number): boolean
  /** Start a program detached from this one, its output discarded: its process id, or null when it did not start. */
  start(command: string[], env: Record<string, string>, cwd: string): number | null
  /** A port for the UI to listen on: picked without listening, which hello is not granted; one taken leaves the UI unopened, and the next hello tries another. */
  pickPort(): number
  newToken(): string
}

export const realAtStartDeps: AtStartDeps = {
  alive: processAlive,
  start(command, env, cwd) {
    const [program, ...args] = command
    const child = spawn(program!, args, { detached: true, stdio: "ignore", cwd, env: { ...process.env, ...env } })
    child.once("error", () => {})
    child.unref()
    return child.pid ?? null
  },
  // Below the systems' ephemeral ranges, where outgoing connections take their ports.
  pickPort: () => 20_000 + Math.floor(Math.random() * 10_000),
  newToken,
}

export interface AtStartPlan {
  root: string
  /** The registry's folder. */
  dir: string
  /** The desktop app's program, or null to open the browser. */
  app: string | null
  /** The command that runs Naima on this project, to which `ui --port <port>` is added. */
  naima: string[]
}

/** The words for the greeting about a UI that stands. */
export const openLine = (r: UiRecord): string =>
  r.how === "desktop" ? "Naima's UI is open in the desktop app." : r.url ? `Naima's UI is open: ${r.url}` : "Naima's UI is opening."

/**
 * Open the UI on the project, or reuse the one open on it: the line the greeting says, or null when nothing is open.
 * Returns at once: what it starts runs on its own. Never throws.
 */
export function openAtStart(plan: AtStartPlan, deps: AtStartDeps = realAtStartDeps): string | null {
  try {
    writeDirs(plan.dir)
    const got = claim(plan.dir, { pid: process.pid, how: "claim" }, deps.alive)
    if (!got) return null
    if ("live" in got) return openLine(got.live)
    if (plan.app) {
      const pid = deps.start([plan.app], { NAIMA_PROJECT: plan.root }, plan.root)
      if (pid === null) return null
      const rec: UiRecord = { pid, how: "desktop" }
      rewrite(plan.dir, got.gen, rec)
      return openLine(rec)
    }
    const port = deps.pickPort()
    const token = deps.newToken()
    const pid = deps.start([...plan.naima, "ui", "--port", String(port)], { NAIMA_UI_TOKEN: token }, plan.root)
    if (pid === null) return null
    const rec: UiRecord = { pid, how: "browser", url: `http://${HOST}:${port}/?token=${token}` }
    rewrite(plan.dir, got.gen, rec)
    return openLine(rec)
  } catch {
    return null
  }
}

/** The command that runs this Naima on the project whose data is `data`: Deno, the program, the data. Null off Deno. */
export function naimaCommand(program: string, data: string): string[] | null {
  const d = (globalThis as { Deno?: { execPath(): string } }).Deno
  if (!d) return null
  return [d.execPath(), "run", "-A", join(program, "naima.ts"), "--data", data]
}
