// Sending a commit to a host's checkout over ssh, under a ref of Naima's: what a checkpoint does to run a suite there
// and what `naima verify --host` does to verify there. Towards a POSIX host a git push; towards a host whose shell is
// cmd, a bundle copied with scp, since git's own ssh quoting breaks the path.

import { spawnSync } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { gitOrNull, gitReason, runGit } from "./git.ts"
import { cmdEscape, cmdQuote, type Host, shellQuote } from "./hosts.ts"
import { tickDir } from "./tick.ts"

/** The ref a checkpoint's tip is pushed to on a host, for the time of the run. */
export const checkpointRef = (tip: string): string => `refs/naima/checkpoint/${tip.slice(0, 12)}`

/** The ref a commit is pushed to on a host to be verified there, for the time of the run. */
export const verifyRef = (tip: string): string => `refs/naima/verify/${tip.slice(0, 12)}`

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
export function sendTipWith(
  root: string,
  h: Host,
  tip: string,
  exec: Exec,
  pause: (ms: number) => void = sleepSync,
  refOf: (tip: string) => string = checkpointRef,
): string | undefined {
  const sent = sendCommit(root, h, tip, exec, pause, refOf)
  if (sent) return sent
  // The product the tip's submodule pointer names may be on no remote yet (a development line's, before it lands): it goes
  // to the product's own checkout on the host, so that the host's `git submodule update` finds it there.
  const sub = gitOrNull(root, "ls-tree", tip, "naima")?.match(/^160000 commit ([0-9a-f]{40})\tnaima$/m)?.[1]
  if (!sub) return undefined
  const repo = join(root, "naima")
  if (!exec("git", ["-C", repo, "cat-file", "-e", `${sub}^{commit}`]).ok) return undefined
  const there = h.shell === "cmd" ? `${h.dir.replace(/[\\/]+$/, "")}\\naima` : `${h.dir.replace(/\/+$/, "")}/naima`
  return sendCommit(repo, { ...h, dir: there }, sub, exec, pause, refOf)
}

/** Put one commit of the repository at `root` in the checkout at `h.dir` on the host, under the checkpoint's ref. */
function sendCommit(root: string, h: Host, tip: string, exec: Exec, pause: (ms: number) => void, refOf: (tip: string) => string): string | undefined {
  const ref = refOf(tip)
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
export function realExec(root: string): Exec {
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

/** The command line, for the host's shell, that removes the ref a commit was sent under in the checkout at `h.dir`. */
export function dropRefCommand(h: Host, ref: string): string {
  if (h.shell !== "cmd") return `git -C ${shellQuote(h.dir.replace(/\/+$/, ""))} update-ref -d ${shellQuote(ref)}`
  const dir = h.dir.replace(/\//g, "\\").replace(/\\+$/, "")
  return `cd /d ${cmdEscape(/[\s%]/.test(dir) ? `"${dir}"` : dir)} && git update-ref -d ${ref}`
}

/** Remove the ref a commit was sent under on the host, once what it was sent for is over: the reason it could not, or none. */
export function dropRef(h: Host, ref: string, exec: Exec): string | undefined {
  const r = exec("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", h.ssh, dropRefCommand(h, ref)])
  return r.ok ? undefined : `could not remove ${ref} on ${h.name}: ${r.err}`
}
