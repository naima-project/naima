// `naima ui` and the desktop app: it opens the installed app on the project, or brings forward the app's window already
// open on it, and falls back to the browser when the app is not installed or cannot start; `naima ui --install-desktop`
// builds the app from the shell the product ships (ui/desktop, the Tauri project, around the bundle in ui/dist) and
// installs it into the user's Applications folder, on macOS.
//
// A window already open on the project is one whose sidecar listens for shows (show.ts, carrier "desktop"): it is asked
// to come forward with the show {kind: "raise"}, which the shell takes for itself and the page never sees. An app
// started here is named in the registry hello reads (at-start.ts), as hello names the one it starts, so that neither
// opens a second.

import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { delimiter, join, posix } from "node:path"
import { fileURLToPath } from "node:url"
import type { Context, Progress } from "../../core/api.ts"
import { claim, desktopApp, desktopAppDirs, drop, processAlive, registryDir, rewrite, type UiRecord } from "./at-start.ts"
import { askShow, openUis, taken } from "./show.ts"

/** This Naima's folder, which ships the shell (ui/desktop) beside the bundle (ui/dist). */
export const PRODUCT: string = fileURLToPath(new URL("../../../", import.meta.url))
/** The version of Tauri's command-line tool the shell builds with: the one the workshop's UI uses. */
export const TAURI_CLI = "npm:@tauri-apps/cli@2.12.4"
/** How long a window open on the project has to say it took the raise, in ms: it looks every POLL_MS. */
export const RAISE_MS = 2_000
/** How long an app just started must keep running before it counts as started, in ms: one that cannot reach its project ends sooner. */
export const SETTLE_MS = 2_000

export type DesktopOpened = { opened: true; how: "raised" | "started" | "starting" } | { opened: false; reason: string }

/** What opening the desktop app does outside this module: each replaced by a test. */
export interface DesktopDeps {
  /** Whether a desktop window open on the project took the raise asked of it. */
  raise(root: string): Promise<boolean>
  alive(pid: number): boolean
  /** Start a program detached from this one, its output discarded: its process id, or null when it did not start. */
  start(command: string[], env: Record<string, string>, cwd: string): number | null
  sleep(ms: number): Promise<void>
}

export const realDesktopDeps: DesktopDeps = {
  async raise(root) {
    if (!openUis(root).some((u) => u.carrier === "desktop")) return false
    const id = askShow(root, { kind: "raise" })
    await taken(root, id, RAISE_MS)
    // A browser's page hears the show too and leaves it: only a desktop window that took it came forward.
    return openUis(root).some((u) => u.carrier === "desktop" && u.took === id)
  },
  alive: processAlive,
  start(command, env, cwd) {
    const [program, ...args] = command
    const child = spawn(program!, args, { detached: true, stdio: "ignore", cwd, env: { ...process.env, ...env } })
    child.once("error", () => {})
    child.unref()
    return child.pid ?? null
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

/**
 * Open the desktop app's program `app` on the project at `root`, or bring forward its window already open there.
 * `dir` is the registry's folder (null outside git). Never throws.
 */
export async function openDesktop(root: string, dir: string | null, app: string, deps: DesktopDeps = realDesktopDeps): Promise<DesktopOpened> {
  try {
    if (await deps.raise(root)) return { opened: true, how: "raised" }
    let gen: number | null = null
    if (dir) {
      mkdirSync(dir, { recursive: true })
      const got = claim(dir, { pid: process.pid, how: "claim" }, deps.alive)
      // An app named in the registry whose window does not answer yet is one still starting: hello's, or another naima ui's.
      if (got && "live" in got && got.live.how === "desktop") return { opened: true, how: "starting" }
      if (got && "gen" in got) gen = got.gen
    }
    const pid = deps.start([app], { NAIMA_PROJECT: root }, root)
    if (pid === null) {
      if (dir && gen !== null) drop(dir, gen)
      return { opened: false, reason: `${app} did not start` }
    }
    const rec: UiRecord = { pid, how: "desktop" }
    if (dir && gen !== null) rewrite(dir, gen, rec)
    await deps.sleep(SETTLE_MS)
    if (!deps.alive(pid)) {
      if (dir && gen !== null) drop(dir, gen)
      return { opened: false, reason: "it ended as it started" }
    }
    return { opened: true, how: "started" }
  } catch (e) {
    return { opened: false, reason: (e as Error).message }
  }
}

/** The line `naima ui` says about the desktop app it opened. */
export const desktopLine = (o: DesktopOpened & { opened: true }, project: string): string =>
  o.how === "raised"
    ? `naima ui: the desktop app is open on ${project}: brought its window to the front`
    : o.how === "starting"
    ? `naima ui: the desktop app is opening on ${project}`
    : `naima ui: opened the desktop app on ${project}`

/**
 * What plain `naima ui` does first: open the desktop app on the project when it is installed, saying so. False sends
 * it on to the browser: the app is not installed (on macOS, with a hint about --install-desktop) or could not open.
 */
export async function desktopFirst(ctx: Context, env: Record<string, string | undefined>, os: string, deps: DesktopDeps = realDesktopDeps): Promise<boolean> {
  const app = desktopApp(desktopAppDirs(env, os))
  if (!app) {
    if (os === "darwin") ctx.out("naima ui: the desktop app is not installed (naima ui --install-desktop builds and installs it); opening the browser")
    return false
  }
  const name = ctx.root.split(/[\\/]/).filter(Boolean).pop() ?? ctx.root
  const o = await openDesktop(ctx.root, registryDir(ctx.root), app, deps)
  if (o.opened) {
    ctx.out(desktopLine(o, name))
    return true
  }
  ctx.out(`naima ui: the desktop app could not open (${o.reason}); opening the browser`)
  return false
}

export { buildDir, installedApp } from "./desktop.ts"

/** Cargo, as PATH finds it, else in rustup's usual place: null when Rust is not installed. */
export function findCargo(env: Record<string, string | undefined>, exists: (path: string) => boolean = existsSync): string | null {
  const dirs = [...(env["PATH"] ?? "").split(delimiter).filter(Boolean), posix.join(env["HOME"] ?? "", ".cargo", "bin")]
  for (const d of dirs) if (exists(join(d, "cargo"))) return join(d, "cargo")
  return null
}

/** What installing the app does outside this module: each replaced by a test. */
export interface InstallDeps {
  /** Run a program in `cwd`, each line of its output handed to `line`: its exit code. */
  run(command: string[], cwd: string, env: Record<string, string>, line: (text: string) => void): Promise<number>
  /** The Deno that runs this Naima, which runs Tauri's command-line tool. */
  deno: string
}

export const realInstallDeps: InstallDeps = {
  run(command, cwd, env, line) {
    const [program, ...args] = command
    return new Promise((done) => {
      const child = spawn(program!, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] })
      for (const stream of [child.stdout, child.stderr]) {
        let rest = ""
        stream.setEncoding("utf8")
        stream.on("data", (chunk: string) => {
          const lines = (rest + chunk).split(/\r?\n/)
          rest = lines.pop() ?? ""
          for (const l of lines) line(l)
        })
        stream.on("end", () => rest && line(rest))
      }
      child.once("error", (e) => {
        line(`${program}: ${e.message}`)
        done(127)
      })
      child.once("close", (code) => done(code ?? 1))
    })
  },
  deno: process.execPath,
}

/** A crate Cargo compiles, as its line says: "Compiling serde v1.0.229". */
const COMPILING = /^\s*Compiling\s+\S+\s+v/

/**
 * `naima ui --install-desktop`: build the desktop app from `product`'s shell and bundle in `build`, and install it at
 * `dest`. It reports its stage and, while Cargo compiles, the crates done of the count the last build ended on.
 * Returns the exit code; `out` says what was done, `err` why it failed.
 */
export async function installDesktop(
  o: { product: string; build: string; dest: string; os: string; cargo: string | null; progress: Progress; out(l: string): void; err(l: string): void },
  deps: InstallDeps = realInstallDeps,
): Promise<number> {
  if (o.os !== "darwin") {
    o.err("naima ui --install-desktop builds the desktop app on macOS only; elsewhere naima ui opens the browser")
    return 1
  }
  const shell = join(o.product, "ui", "desktop")
  const dist = join(o.product, "ui", "dist")
  if (!existsSync(join(shell, "tauri.conf.json")) || !existsSync(join(dist, "index.html"))) {
    o.err(`naima ui --install-desktop: this Naima ships no desktop shell (${posix.join("ui", "desktop")}) or no bundle; update Naima first`)
    return 1
  }
  if (!o.cargo) {
    o.err("naima ui --install-desktop: Rust is not installed: install it from https://rustup.rs, then run this again")
    return 1
  }
  const log = join(o.build, "build.log")
  const counted = join(o.build, "crates.json")
  try {
    o.progress.stage("copy the shell and the page", 2, "folders")
    mkdirSync(o.build, { recursive: true })
    rmSync(join(o.build, "src-tauri"), { recursive: true, force: true })
    rmSync(join(o.build, "dist"), { recursive: true, force: true })
    cpSync(shell, join(o.build, "src-tauri"), { recursive: true })
    o.progress.at(1)
    cpSync(dist, join(o.build, "dist"), { recursive: true })
    o.progress.at(2)
  } catch (e) {
    o.err(`naima ui --install-desktop: cannot copy the shell into ${o.build}: ${(e as Error).message}`)
    return 1
  }
  let last: number | undefined
  try {
    last = (JSON.parse(readFileSync(counted, "utf8")) as { crates?: number }).crates
  } catch {
    // the first build: no count to go by
  }
  o.progress.stage("compile the app", last, "crates", true)
  let crates = 0
  const lines: string[] = []
  // The page is built already (ui/dist): the shell's own beforeBuildCommand, the workshop's, is not run here.
  const config = JSON.stringify({ build: { beforeBuildCommand: "", frontendDist: "../dist" } })
  const env = { CARGO_TARGET_DIR: join(o.build, "target"), PATH: `${posix.dirname(o.cargo)}${delimiter}${process.env["PATH"] ?? ""}` }
  const code = await deps.run([deps.deno, "run", "-A", TAURI_CLI, "build", "--bundles", "app", "--config", config], o.build, env, (l) => {
    lines.push(l)
    if (COMPILING.test(l)) o.progress.at(++crates)
    else if (/^\s*(Finished|Bundling|Running)\b/.test(l)) o.progress.note(l.trim())
  })
  try {
    writeFileSync(log, lines.join("\n") + "\n")
  } catch {
    // the log is a help, not the work
  }
  if (code !== 0) {
    o.err(`naima ui --install-desktop: the build failed (exit ${code}); its output is in ${log}`)
    for (const l of lines.slice(-8)) o.err(`  ${l}`)
    return 1
  }
  if (crates) writeFileSync(counted, JSON.stringify({ crates }) + "\n")
  const built = join(o.build, "target", "release", "bundle", "macos", "Naima.app")
  if (!existsSync(built)) {
    o.err(`naima ui --install-desktop: the build ended without ${built}; its output is in ${log}`)
    return 1
  }
  try {
    o.progress.stage("install the app", 1, "app")
    mkdirSync(posix.dirname(o.dest), { recursive: true })
    rmSync(o.dest, { recursive: true, force: true })
    cpSync(built, o.dest, { recursive: true, verbatimSymlinks: true })
    o.progress.at(1)
  } catch (e) {
    o.err(`naima ui --install-desktop: cannot install it at ${o.dest}: ${(e as Error).message}`)
    return 1
  } finally {
    o.progress.end()
  }
  o.out(`naima ui --install-desktop: installed ${o.dest}; naima ui opens it on the project`)
  return 0
}
