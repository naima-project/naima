// The supervisor: the one process that starts a run's command, signals it and
// records it. `naima run` starts it detached, so it outlives the session that
// asked for the run, and it writes the run's status.json — heartbeat, elapsed
// time, size on disk, end — every `everyMs`. It also removes what a run
// declared it creates, for `naima run clean`, granted write access to those
// paths alone. Run as a program:
//
//   supervisor.ts supervise <record dir>
//   supervisor.ts clean <record dir>
//
// Of the core it imports only the API, through the record's module: it is started on its own, by Deno, Node or Bun.

import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { createWriteStream, existsSync, lstatSync, readdirSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  DEFAULTS,
  lastLine,
  LOG_FILE,
  mtime,
  PROGRESS_FILE,
  readSpec,
  type Reason,
  type RunSpec,
  type RunStatus,
  sampleProgress,
  STATUS_FILE,
  STOP_FILE,
  writeJsonAtomic,
} from "./records.ts"

/** How a platform runs a command line, and ends a process tree: the only places the platforms differ. */
export interface Platform {
  /** The shell and the arguments before the command line. */
  shell: [string, string[]]
  /** Whether the command gets a process group of its own, ended as one (POSIX), or a tree ended through taskkill (Windows). */
  groups: boolean
  /** The program and arguments that end the tree under `pid`, forcibly or not: null when a signal to the group does it. */
  endTree(pid: number, force: boolean): [string, string[]] | null
}

export function platformOf(platform: string, env: Record<string, string | undefined>): Platform {
  if (platform === "win32") {
    return {
      shell: [env["COMSPEC"] ?? "cmd.exe", ["/d", "/s", "/c"]],
      groups: false,
      endTree: (pid, force) => ["taskkill", ["/pid", String(pid), "/T", ...(force ? ["/F"] : [])]],
    }
  }
  return { shell: ["sh", ["-c"]], groups: true, endTree: () => null }
}

/** The size on disk of `path`, every file under it counted once: allocated blocks where the platform says, else the length. */
export function sizeOf(path: string): number {
  let st
  try {
    st = lstatSync(path)
  } catch {
    return 0
  }
  const own = typeof st.blocks === "number" && st.blocks >= 0 && process.platform !== "win32" ? st.blocks * 512 : st.size
  if (!st.isDirectory()) return own
  let total = own
  let entries: string[] = []
  try {
    entries = readdirSync(path)
  } catch {
    return total
  }
  for (const e of entries) total += sizeOf(join(path, e))
  return total
}

/** The tracked files with changes in the repository around `cwd`, as git lists them: null outside a repository. */
export function trackedChanges(cwd: string): string[] | null {
  const r = spawnSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=no"], { cwd, encoding: "utf8" })
  if (r.status !== 0) return null
  return r.stdout.split("\0").filter(Boolean).map((l) => l.slice(3)).sort()
}

const alive = (pid: number, groups: boolean): boolean => {
  try {
    process.kill(groups ? -pid : pid, 0)
    return true
  } catch (e) {
    return (e as { code?: string }).code === "EPERM"
  }
}

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** End the command's tree: SIGTERM (taskkill /T), then SIGKILL (/F) after the grace if anything of it is left. */
export async function endTree(pid: number, p: Platform, graceMs: number): Promise<void> {
  const send = (force: boolean): void => {
    const program = p.endTree(pid, force)
    if (program) spawnSync(program[0], program[1], { stdio: "ignore", windowsHide: true })
    else {
      try {
        process.kill(-pid, force ? "SIGKILL" : "SIGTERM")
      } catch { /* nothing of it is left */ }
    }
  }
  if (!alive(pid, p.groups)) return
  send(false)
  const until = Date.now() + graceMs
  while (Date.now() < until) {
    if (!alive(pid, p.groups)) return
    await delay(100)
  }
  if (alive(pid, p.groups)) send(true)
}

/** Supervise the run recorded in `dir` until it ends; resolves once its end is written. */
export async function supervise(dir: string, graceMs: number = DEFAULTS.graceMs): Promise<RunStatus> {
  const spec = readSpec(dir)
  if (!spec) throw new Error(`no run.json in ${dir}`)
  const p = platformOf(process.platform, process.env)
  const started = Date.parse(spec.started)
  let status: RunStatus = { state: "starting", supervisorPid: process.pid, heartbeat: new Date().toISOString(), elapsedMs: 0 }
  const write = (patch: Partial<RunStatus>): void => {
    status = { ...status, ...patch, heartbeat: new Date().toISOString(), elapsedMs: Date.now() - started }
    writeJsonAtomic(join(dir, STATUS_FILE), status)
  }
  write({})
  const before = spec.guardTracked ? trackedChanges(spec.cwd) : null
  const log = createWriteStream(join(dir, LOG_FILE), { flags: "a" })
  // The tick's folder is the launcher's, for this Naima: the command gets none, so a Naima it runs, or a test suite, finds its own.
  const { NAIMA_TICK_DIR: _tick, ...inherited } = process.env
  const env = { ...inherited, NAIMA_RUN_NAME: spec.name, NAIMA_RUN_DIR: dir, NAIMA_RUN_PROGRESS: join(dir, PROGRESS_FILE) }
  const [program, args] = spec.shell ? [p.shell[0], [...p.shell[1], spec.command[0] ?? ""]] : [spec.command[0] ?? "", spec.command.slice(1)]
  let child: ChildProcess
  try {
    child = spawn(program, args, {
      cwd: spec.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      windowsHide: true,
      ...(spec.shell && process.platform === "win32" ? { windowsVerbatimArguments: true } : {}),
    })
  } catch (e) {
    write({ state: "ended", reason: "start-failed", error: (e as Error).message, ended: new Date().toISOString(), exitCode: null, signal: null })
    return status
  }
  child.stdout?.pipe(log, { end: false })
  child.stderr?.pipe(log, { end: false })
  let reason: Reason | null = null
  const exited = new Promise<{ code: number | null; signal: string | null; error?: string }>((done) => {
    child.once("error", (e) => done({ code: null, signal: null, error: e.message }))
    child.once("exit", (code, signal) => done({ code, signal }))
  })
  if (child.pid !== undefined) write({ state: "running", pid: child.pid })
  const end = (why: Reason): void => {
    if (reason || child.pid === undefined) return
    reason = why
    void endTree(child.pid, p, graceMs)
  }
  const tick = (): void => {
    const patch: Partial<RunStatus> = {}
    // The progress line's first sample in each stage: what readers measure a rate from (specs/progress-long-work-says-how-far, §3.1).
    const progressFile = join(dir, PROGRESS_FILE)
    const sampled = sampleProgress(lastLine(progressFile), mtime(progressFile), status)
    if (sampled.progressFrom) patch.progressFrom = sampled.progressFrom
    if (sampled.overallFrom) patch.overallFrom = sampled.overallFrom
    if (spec.creates.length) {
      const size = spec.creates.reduce((n, path) => n + sizeOf(path), 0)
      patch.sizeBytes = size
      patch.peakBytes = Math.max(status.peakBytes ?? 0, size)
    }
    write(patch)
    if (existsSync(join(dir, STOP_FILE))) end("stopped")
    else if (Date.now() - started > spec.budgetTimeMs) end("budget-time")
    else if (spec.budgetDiskBytes !== undefined && (patch.sizeBytes ?? 0) > spec.budgetDiskBytes) end("budget-disk")
  }
  const timer = setInterval(tick, spec.everyMs)
  tick()
  const result = await exited
  clearInterval(timer)
  // A run leaves nothing running: what the command left in its group is ended too.
  if (child.pid !== undefined && p.groups) await endTree(child.pid, p, graceMs)
  await Promise.race([new Promise((done) => log.end(done)), delay(2_000)])
  const after = before !== null ? trackedChanges(spec.cwd) : null
  const changed = before !== null && after !== null ? after.filter((f) => !before.includes(f)) : []
  const final: Partial<RunStatus> = {
    state: "ended",
    exitCode: result.code,
    signal: result.signal,
    reason: result.error ? "start-failed" : reason ?? "exit",
    ended: new Date().toISOString(),
    ...(result.error ? { error: result.error } : {}),
    ...(changed.length ? { changedTracked: changed } : {}),
  }
  if (spec.creates.length) {
    const size = spec.creates.reduce((n, path) => n + sizeOf(path), 0)
    final.sizeBytes = size
    final.peakBytes = Math.max(status.peakBytes ?? 0, size)
  }
  write(final)
  return status
}

/** Remove what the run in `dir` declared it creates, then the record: `naima run clean`, once its checks have passed. */
export function clean(dir: string, spec: RunSpec): void {
  for (const path of spec.creates) if (existsSync(path)) rmSync(path, { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })
}

const self = fileURLToPath(import.meta.url)

if (process.argv[1] && resolve(process.argv[1]) === self) {
  const [mode, dir] = process.argv.slice(2)
  if (!dir || (mode !== "supervise" && mode !== "clean")) {
    console.error("usage: supervisor.ts supervise|clean <record dir>")
    process.exit(2)
  }
  if (mode === "clean") {
    const spec = readSpec(dir)
    if (!spec) {
      console.error(`no run.json in ${dir}`)
      process.exit(2)
    }
    clean(dir, spec)
    process.exit(0)
  }
  supervise(dir).then(() => process.exit(0), (e) => {
    console.error(String(e))
    process.exit(70)
  })
}
