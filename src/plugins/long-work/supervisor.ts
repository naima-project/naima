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
  /** Whether a gentle ending comes first: not on Windows, where taskkill without /F cannot end a console program and may end only its cmd. */
  graceful: boolean
}

export function platformOf(platform: string, env: Record<string, string | undefined>): Platform {
  if (platform === "win32") {
    return {
      shell: [env["COMSPEC"] ?? "cmd.exe", ["/d", "/s", "/c"]],
      groups: false,
      graceful: false,
      endTree: (pid, force) => ["taskkill", ["/pid", String(pid), "/T", ...(force ? ["/F"] : [])]],
    }
  }
  return { shell: ["sh", ["-c"]], groups: true, graceful: true, endTree: () => null }
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

/** How often a run's descendants are listed on a platform without process groups (a listing costs about a second). */
const SEEN_EVERY_MS = 15_000

const alive = (pid: number, groups: boolean): boolean => {
  try {
    process.kill(groups ? -pid : pid, 0)
    return true
  } catch (e) {
    return (e as { code?: string }).code === "EPERM"
  }
}

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/**
 * A wait for a child's output to be read to its end, started when the child is: the child's `exit` may come while its
 * output is still in the pipes (Node's documented order, seen under Bun and under load), and a log ended then loses the
 * last lines, which `naima wait` prints. The wait is bounded, since a process the command left behind may hold a pipe
 * open: it says whether the output closed within `ms`.
 */
export function outputClosed(child: { once(event: "close", listener: () => void): unknown }): (ms: number) => Promise<boolean> {
  let closed = false
  const done = new Promise<void>((resolve) => child.once("close", () => (closed = true, resolve())))
  return async (ms) => {
    if (!closed) await Promise.race([done, delay(ms)])
    return closed
  }
}

/** A process as the platform lists it: its id, its parent's, and when it was created (told apart from a later process that reuses the id). */
export interface ProcRow {
  pid: number
  ppid: number
  created: string
}

/** The rows of a process table printed by `processTable`'s script: one per line, `pid<TAB>ppid<TAB>created`; any other line is skipped. */
export function parseProcessTable(text: string): ProcRow[] {
  const rows: ProcRow[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\d+)\t(\d+)\t(\S+)$/.exec(line.trim())
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), created: m[3]! })
  }
  return rows
}

/**
 * The processes below `root` in `rows`, at any depth, root excluded. A row counts as a child only when it was created
 * no earlier than its parent: a process whose parent id was since reused by another is not that one's child.
 */
export function descendants(rows: ProcRow[], root: number): ProcRow[] {
  const byParent = new Map<number, ProcRow[]>()
  for (const r of rows) byParent.set(r.ppid, [...(byParent.get(r.ppid) ?? []), r])
  const created = new Map(rows.map((r) => [r.pid, r.created]))
  const found: ProcRow[] = []
  const seen = new Set<number>([root])
  const queue = [root]
  while (queue.length) {
    const parent = queue.shift()!
    for (const c of byParent.get(parent) ?? []) {
      const at = created.get(parent)
      if (seen.has(c.pid) || (at !== undefined && c.created < at)) continue
      seen.add(c.pid)
      found.push(c)
      queue.push(c.pid)
    }
  }
  return found
}

/** What lists the processes on Windows: id, parent id and creation instant (UTC, sortable), one per line. */
const PROCESS_TABLE_SCRIPT =
  "Get-CimInstance Win32_Process | ForEach-Object { if ($_.CreationDate) { \"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.CreationDate.ToUniversalTime().ToString('o'))\" } }"

/** The process table of this Windows machine; empty when it cannot be listed. */
export function processTable(): ProcRow[] {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PROCESS_TABLE_SCRIPT], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
  })
  return r.status === 0 ? parseProcessTable(String(r.stdout ?? "")) : []
}

const keyOf = (r: ProcRow): string => `${r.pid}@${r.created}`

/**
 * Where a run's descendants are remembered on a platform without process groups: a command's tree is ended through its
 * root, so a process whose parent has already gone (a browser a hung test left) is out of reach unless it was seen
 * while the tree was whole.
 */
export class Descendants {
  private known = new Map<string, ProcRow>()
  private root: number
  private table: () => ProcRow[]
  constructor(root: number, table: () => ProcRow[] = processTable) {
    this.root = root
    this.table = table
  }
  /** Remember what is below the root now. */
  see(): void {
    for (const r of descendants(this.table(), this.root)) this.known.set(keyOf(r), r)
  }
  /** The remembered processes still alive (same id, same creation instant), ended through `end`; how many there were. */
  sweep(end: (pid: number) => void): number {
    const alive = new Set(this.table().map(keyOf))
    const left = [...this.known].filter(([k]) => alive.has(k)).map(([, r]) => r)
    for (const r of left) end(r.pid)
    this.known.clear()
    return left.length
  }
}

/**
 * End the command's tree: SIGTERM, then SIGKILL after the grace if anything of it is left. On a platform with no gentle
 * ending (Windows) the tree is ended forcibly at once, root dead or alive: its children may outlive a root that went first.
 */
export async function endTree(
  pid: number,
  p: Platform,
  graceMs: number,
  run: (program: string, args: string[]) => void = (program, args) => void spawnSync(program, args, { stdio: "ignore", windowsHide: true }),
): Promise<void> {
  const send = (force: boolean): void => {
    const program = p.endTree(pid, force)
    if (program) run(program[0], program[1])
    else {
      try {
        process.kill(-pid, force ? "SIGKILL" : "SIGTERM")
      } catch { /* nothing of it is left */ }
    }
  }
  if (!p.graceful) return send(true)
  if (!alive(pid, p.groups)) return
  send(false)
  const until = Date.now() + graceMs
  while (Date.now() < until) {
    if (!alive(pid, p.groups)) return
    await delay(100)
  }
  if (alive(pid, p.groups)) send(true)
}

/**
 * Whether a command ended as one that never started: run through the shell, which exited at once with its own status
 * for a command not found or not executable (127, 126; 9009 under cmd).
 */
export function notFound(shell: boolean, platform: string, code: number | null, afterMs: number): boolean {
  if (!shell || code === null || afterMs > DEFAULTS.notFoundMs) return false
  return platform === "win32" ? code === 9009 : code === 127 || code === 126
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
  // naima run gave up waiting for this supervisor and left a stop request: a supervisor late to start starts nothing.
  if (existsSync(join(dir, STOP_FILE))) {
    write({
      state: "ended",
      reason: "start-failed",
      error: "naima run stopped waiting for the command to start",
      ended: new Date().toISOString(),
      exitCode: null,
      signal: null,
    })
    return status
  }
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
      // A group of its own on POSIX, ended as one. Never detached on Windows: a detached command line's cmd has no console,
      // and the programs it starts write to a console of their own, not to the log; the tree is ended through taskkill.
      detached: p.groups,
      windowsHide: true,
      ...(spec.shell && process.platform === "win32" ? { windowsVerbatimArguments: true } : {}),
    })
  } catch (e) {
    write({ state: "ended", reason: "start-failed", error: (e as Error).message, ended: new Date().toISOString(), exitCode: null, signal: null })
    return status
  }
  child.stdout?.pipe(log, { end: false })
  child.stderr?.pipe(log, { end: false })
  const drained = outputClosed(child)
  let reason: Reason | null = null
  const exited = new Promise<{ code: number | null; signal: string | null; error?: string; exitAt: number }>((done) => {
    child.once("error", (e) => done({ code: null, signal: null, error: e.message, exitAt: Date.now() }))
    child.once("exit", (code, signal) => done({ code, signal, exitAt: Date.now() }))
  })
  const spawned = Date.now()
  if (child.pid !== undefined) write({ state: "running", pid: child.pid })
  const below = !p.groups && child.pid !== undefined ? new Descendants(child.pid) : null
  let seenAt = Date.now()
  let ending: Promise<void> = Promise.resolve()
  const end = (why: Reason): void => {
    if (reason || child.pid === undefined) return
    reason = why
    below?.see()
    ending = endTree(child.pid, p, graceMs)
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
    if (below && !reason && Date.now() - seenAt >= SEEN_EVERY_MS) {
      below.see()
      seenAt = Date.now()
    }
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
  // Without process groups: the end asked for is awaited, then what was seen below the command and still lives is ended.
  await ending
  below?.sweep((pid) => {
    const [program, args] = p.endTree(pid, true) ?? ["taskkill", ["/pid", String(pid), "/T", "/F"]]
    spawnSync(program, args, { stdio: "ignore", windowsHide: true })
  })
  // The run's end is recorded only once its whole output is in the log: a reader that sees "ended" reads the last line too.
  await drained(2_000)
  await Promise.race([new Promise((done) => log.end(done)), delay(2_000)])
  const after = before !== null ? trackedChanges(spec.cwd) : null
  const changed = before !== null && after !== null ? after.filter((f) => !before.includes(f)) : []
  const missing = notFound(spec.shell, process.platform, result.code, result.exitAt - spawned)
  const final: Partial<RunStatus> = {
    state: "ended",
    exitCode: result.code,
    signal: result.signal,
    reason: result.error || missing ? "start-failed" : reason ?? "exit",
    ended: new Date().toISOString(),
    ...(result.error
      ? { error: result.error }
      : missing
      ? { error: lastLine(join(dir, LOG_FILE)) ?? `the shell exited ${result.code}: the command was not found or cannot run` }
      : {}),
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
