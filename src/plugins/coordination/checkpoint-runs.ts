// The background runs of a checkpoint: the project's suites (the coordination option checkpointRuns, each on its host or
// here) and the verification of every formal property that is not current (on the option verifyHost), all started through
// `naima run`, read back through `naima run status`, and settled into the checkpoint record: a pass or a failure per run.
// A failed run blocks the gate through the record and files, or updates, a bug.
import { spawnSync } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  type CheckpointRecord,
  type CheckpointRun,
  type CheckpointRunSpec,
  cmdEscape,
  cmdQuote,
  type Context,
  contextIn,
  createItem,
  gitReason,
  type Host,
  isOpen,
  type Item,
  joinProse,
  label,
  noHost,
  NOTES_HEADING,
  privateContext,
  projectHosts,
  readReadme,
  redactPrivate,
  runGit,
  saveProse,
  splitProse,
  tickDir,
  today,
  updateCheckpoint,
} from "../../core/api.ts"
import { naimaHere } from "./land.ts"

/** How long a suite may run and stay silent, and the same for the verification of the properties. */
const SUITE = { budget: "2h", stale: "30m" }
const VERIFY = { budget: "6h", stale: "1h" }

/** The ref a checkpoint's tip is pushed to on a host, for the time of the run. */
const checkpointRef = (tip: string): string => `refs/naima/checkpoint/${tip.slice(0, 12)}`

/** The properties not current: the ones the properties gate blocks on, less those whose files are gone, which no run brings current. */
export async function notCurrentProperties(ctx: Context): Promise<Item[]> {
  const gate = ctx.registry.find<{ evaluate(c: Context): unknown }>("gates", "properties")
  if (!gate) return []
  const r = (await gate.value.evaluate(ctx)) as { blocking?: Item[]; stuck?: Item[] }
  const stuck = new Set((r.stuck ?? []).map((i) => i.slug))
  return (r.blocking ?? []).filter((i) => !stuck.has(i.slug))
}

/** Run `naima <command> <args>` here and collect what it printed. */
async function ask(ctx: Context, command: string, args: string[]): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = []
  const cmd = ctx.registry.commands.get(command)
  if (!cmd) return { code: 1, lines: [`naima ${command} is not loaded: the long-work plugin provides it`] }
  const quiet = contextIn(ctx, ctx.root, { out: (l = "") => void lines.push(l), err: (l = "") => void lines.push(l), now: ctx.now })
  try {
    return { code: await cmd.run(args, quiet), lines }
  } catch (e) {
    return { code: 1, lines: [...lines, e instanceof Error ? e.message : String(e)] }
  }
}

const lastLine = (lines: string[]): string => lines.filter(Boolean).pop() ?? "nothing said"

/** The word of the run for one host's shell: the command line the host runs, at the checkpoint's tip. */
function hostLine(tip: string, command: string): string {
  const ref = checkpointRef(tip)
  return `git checkout -q --detach ${ref} && git submodule update --init -q && ${command}`
}

/** Start one run through `naima run`; its record, started or failed at once. */
async function start(
  ctx: Context,
  tip: string,
  name: string,
  kind: CheckpointRun["kind"],
  what: string,
  host: string | undefined,
  command: string[],
  limits: { budget: string; stale: string },
): Promise<CheckpointRun> {
  const run = `checkpoint-${tip.slice(0, 12)}-${name}`
  const base: CheckpointRun = { run, name, kind, what, ...(host ? { host } : {}), state: "running" }
  await ask(ctx, "run", ["clean", run])
  const r = await ask(ctx, "run", [run, ...(host ? ["--host", host] : []), "--budget-time", limits.budget, "--stale", limits.stale, "--", ...command])
  return r.code === 0 ? base : { ...base, state: "failed", why: clean(ctx, `could not start: ${lastLine(r.lines)}`) }
}

/**
 * Start every run of a checkpoint on `tip`: each configured suite, then one verification of every property not current.
 * A suite on a host gets the tip sent there first (the host's checkout is moved to it, a plain git push of a ref).
 */
export async function startRuns(
  ctx: Context,
  tip: string,
  suites: CheckpointRunSpec[],
  verifyOn: string | undefined,
  send: (ctx: Context, host: string, tip: string) => string | undefined = sendTip,
): Promise<CheckpointRun[]> {
  const runs: CheckpointRun[] = []
  for (const s of suites) {
    if (s.host) {
      const sent = send(ctx, s.host, tip)
      if (sent) {
        runs.push({
          run: `checkpoint-${tip.slice(0, 12)}-${s.name}`,
          name: s.name,
          kind: "suite",
          what: s.command,
          host: s.host,
          state: "failed",
          why: clean(ctx, sent),
        })
        continue
      }
    }
    runs.push(
      await start(ctx, tip, s.name, "suite", s.command, s.host, [s.host ? hostLine(tip, s.command) : s.command], {
        budget: s.budget ?? SUITE.budget,
        stale: SUITE.stale,
      }),
    )
  }
  const stale = await notCurrentProperties(ctx)
  if (stale.length) {
    const slugs = stale.map((i) => i.slug)
    runs.push(
      await start(ctx, tip, "verify", "verify", `naima verify ${slugs.join(" ")}`, undefined, [
        ...naimaHere(ctx.trackerRoot),
        "verify",
        ...slugs,
        ...(verifyOn ? ["--host", verifyOn] : []),
      ], VERIFY),
    )
  }
  return runs
}

/** One command run for the sending of a tip: whether it succeeded, and what it said on failure. */
export type Exec = (cmd: string, args: string[]) => { ok: boolean; err: string }

/** What git and ssh say when the link dropped, as opposed to when the host refused: worth another try. */
const DROPPED =
  /could not read from remote repository|connection (closed|reset|timed out|refused)|broken pipe|kex_exchange|ssh: connect to host|operation timed out|lost connection/i

/** How often a command that met a dropped link is run, and the pause before each new try. */
const TRIES = 3
const PAUSE_MS = 2000

const sleepSync = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Run `cmd` until it succeeds, or fails for a reason that is not a dropped link, or the tries are used; its last result. */
function persist(exec: Exec, pause: (ms: number) => void, cmd: string, args: string[]): { ok: boolean; err: string } {
  let r = exec(cmd, args)
  for (let n = 1; !r.ok && n < TRIES && DROPPED.test(r.err); n++) {
    pause(PAUSE_MS * n)
    r = exec(cmd, args)
  }
  return r
}

/**
 * Put the tip in the host's checkout under the checkpoint's ref. Towards a POSIX host, a git push over ssh. Towards a
 * host whose shell is cmd, git's own ssh quoting breaks the path, so the tip travels as a bundle: made here, copied with
 * scp into the host's git directory, fetched there and removed. A dropped link is tried again, twice. The reason it
 * could not be sent, or none.
 */
export function sendTipWith(root: string, h: Host, tip: string, exec: Exec, pause: (ms: number) => void = sleepSync): string | undefined {
  const ref = checkpointRef(tip)
  const fail = (err: string): string => `could not send ${tip.slice(0, 12)} to ${h.name}: ${err}`
  if (h.shell !== "cmd") {
    const pushed = persist(exec, pause, "git", ["-C", root, "push", "--no-verify", "--quiet", "--force", `${h.ssh}:${h.dir}`, `${tip}:${ref}`])
    return pushed.ok ? undefined : fail(pushed.err)
  }
  const file = `naima-checkpoint-${tip.slice(0, 12)}.bundle`
  // The bundle is made in Naima's state folder in the clone's git directory, the one place outside the tracker the
  // launcher lets the command read and write (the system's temporary folder it may not), else in the temporary folder.
  const state = tickDir(root)
  const folder = state ? dirname(state) : tmpdir()
  const local = join(folder, file)
  const fwd = h.dir.replace(/\\/g, "/").replace(/\/+$/, "")
  const winDir = h.dir.replace(/\//g, "\\").replace(/\\+$/, "")
  try {
    mkdirSync(folder, { recursive: true })
    const made = exec("git", ["-C", root, "update-ref", ref, tip])
    if (!made.ok) return fail(made.err)
    const bundled = exec("git", ["-C", root, "bundle", "create", "--quiet", local, ref])
    if (!bundled.ok) return fail(bundled.err)
    const copied = persist(exec, pause, "scp", ["-q", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", local, `${h.ssh}:${fwd}/.git/${file}`])
    if (!copied.ok) return fail(copied.err)
    const there = cmdQuote(`${winDir}\\.git\\${file}`)
    const fetched = persist(exec, pause, "ssh", [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=8",
      h.ssh,
      `cd /d ${cmdEscape(/[\s%]/.test(winDir) ? `"${winDir}"` : winDir)} && git fetch -q ${there} +${ref}:${ref} && del /q ${there}`,
    ])
    return fetched.ok ? undefined : fail(fetched.err)
  } finally {
    exec("git", ["-C", root, "update-ref", "-d", ref])
    rmSync(local, { force: true })
  }
}

/** Run a command for real: git through Naima's own git runner, the rest as itself. */
function realExec(root: string): Exec {
  return (cmd, args) => {
    if (cmd === "git") {
      const r = runGit(root, args.slice(2))
      return { ok: r.ok, err: r.ok ? "" : gitReason(r) }
    }
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 600_000, stdio: ["ignore", "pipe", "pipe"] })
    // No status, no signal and no error: the program was never started, as when the launcher does not let this command run it.
    const never = !r.error && r.status == null && !r.signal
    return {
      ok: r.status === 0,
      err: r.error
        ? `${cmd}: ${r.error.message}`
        : never
        ? `${cmd} could not be started: this command may not run it`
        : String(r.stderr ?? "").trim().split("\n").pop() ?? "",
    }
  }
}

/** Push the tip to the host's checkout as a ref, for its suite to check out; the reason it could not, or none. */
export function sendTip(ctx: Context, host: string, tip: string): string | undefined {
  try {
    const hosts = projectHosts(ctx.config.plugins["long-work"]?.options ?? {})
    const h = hosts.get(host)
    if (!h) return noHost(host, hosts)
    return sendTipWith(ctx.root, h, tip, realExec(ctx.root))
  } catch (e) {
    return `could not send ${tip.slice(0, 12)} to ${host}: ${e instanceof Error ? e.message : String(e)}`
  }
}

/** What `naima run status` says of a run, read once. */
async function state(ctx: Context, run: string): Promise<{ state: CheckpointRun["state"]; why?: string }> {
  const r = await ask(ctx, "run", ["status", run, "--json", "--tail", "20"])
  let v: { state?: string; over?: boolean; error?: string; tail?: string[] }
  try {
    v = JSON.parse(r.lines.join("\n")) as typeof v
  } catch {
    return { state: "failed", why: `its run could not be read: ${lastLine(r.lines)}` }
  }
  const last = (v.tail ?? []).filter(Boolean).pop()
  if (!v.over) return { state: "running", ...(last ? { why: last } : {}) }
  if (v.state === "succeeded") return { state: "passed" }
  return { state: "failed", why: `${v.state ?? "ended"}${v.error ? `: ${v.error}` : last ? `: ${last}` : ""}` }
}

const clean = (ctx: Context, text: string): string => redactPrivate(text.split(ctx.root).join("<root>"), privateContext())

/** File a bug for a failed run, or add a note to the open one of the same title; its label, or none when the project has no bugs. */
export function fileBug(ctx: Context, r: CheckpointRun, tip: string): string | undefined {
  const type = ctx.registry.types.get("bugs")
  if (!type) return undefined
  const title = `Checkpoint run ${r.name} fails`
  const open = ctx.repo.items.find((i) => i.type === "bugs" && i.meta["title"] === title && isOpen(ctx, i))
  const said = clean(
    ctx,
    `The ${r.kind === "verify" ? "verification of the properties not current" : "suite"} \`${r.what}\`${
      r.host ? ` on ${r.host}` : ""
    } failed at the checkpoint of ${tip.slice(0, 12)}: ${r.why ?? "no reason read"}. Its log: naima run status ${r.run}.`,
  )
  if (open) {
    const prose = splitProse(readReadme(open))
    saveProse(ctx, open, joinProse({ ...prose, notes: [prose.notes || NOTES_HEADING, `### ${today(ctx)} — checkpoint\n\n${said}`].join("\n\n") }))
    return label(open)
  }
  const bug = createItem(ctx, type, title)
  saveProse(ctx, bug, joinProse({ ...splitProse(readReadme(bug)), description: said }))
  return label(bug)
}

/**
 * Read every running run of the record, and settle it when none is left: passed when the landing checks and every run
 * passed, else failed; each failed run files or updates a bug. Returns the record as it stands.
 */
export async function settle(ctx: Context, record: CheckpointRecord): Promise<CheckpointRecord> {
  if (!record.pending) return record
  const runs: CheckpointRun[] = []
  for (const r of record.runs ?? []) runs.push(r.state === "running" ? { ...r, ...(await state(ctx, r.run)) } : r)
  const open = runs.some((r) => r.state === "running")
  if (open) return updateCheckpoint(ctx, record.id, { runs })
  const out = runs.map((r) => {
    if (r.state !== "failed" || r.bug) return r
    try {
      const bug = fileBug(ctx, r, record.tip)
      return bug ? { ...r, bug } : r
    } catch (e) {
      // On a development line tracker data is not written (the trunk's alone): the failure stays in the record, and the bug is filed from the trunk.
      const first = (e instanceof Error ? e.message : String(e)).split("\n")[0]!
      return { ...r, why: `${r.why ?? "failed"} — file the bug "Checkpoint run ${r.name} fails" from the trunk's checkout (${clean(ctx, first)})` }
    }
  })
  const failed = [...record.failed, ...out.filter((r) => r.state === "failed").map((r) => `${r.name}: ${r.why ?? "failed"}`)]
  return updateCheckpoint(ctx, record.id, { runs: out, pending: false, passed: failed.length === 0, failed })
}

/** The lines `naima checkpoint --status` prints for a record. */
export function statusLines(record: CheckpointRecord): string[] {
  const runs = record.runs ?? []
  const over = runs.filter((r) => r.state !== "running").length
  const head = record.pending ? `running, ${over} of ${runs.length} runs over` : record.passed ? "passed" : "FAILED"
  const lines = [`checkpoint ${record.tip.slice(0, 12)}${record.gate ? ` for ${record.gate}` : ""}: ${head}`]
  for (const r of runs) {
    const mark = r.state === "passed" ? "✓" : r.state === "failed" ? "✗" : "…"
    lines.push(`  ${mark} ${r.run}${r.host ? ` on ${r.host}` : ""}: ${r.state}${r.why ? ` — ${r.why}` : ""}${r.bug ? ` (bug ${r.bug})` : ""}`)
  }
  if (!record.pending) { for (const f of record.failed) lines.push(`  ✗ ${f}`) }
  return lines
}
