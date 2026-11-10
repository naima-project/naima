// Installing one tool: download into a staging directory, check the size and
// the sha256, unpack with the platform's own programs, verify by running the
// tool, write the receipt, and rename the install into place
// (specs/tools-plugin-declares-tools-needs-naima-tools, §4). Nothing is written
// outside the tools directory, and a failure leaves no tool behind.

import { createHash, randomUUID } from "node:crypto"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs"
import { dirname, join } from "node:path"
import { installDirOf, NaimaError, NO_PROGRESS, programFile, type Progress, RECEIPT, spawnSyncFed, tarCommand } from "../../core/api.ts"
import type { Source, ToolDeclaration } from "./contract.ts"

/** What one program run gave. */
export interface ExecResult {
  status: number | null
  stdout: string
  stderr: string
  error?: string
}

/** Runs one program: the real one starts it; a test stands in for `hdiutil`. */
export type Exec = (program: string, args: string[], options?: { cwd?: string; input?: string }) => ExecResult

export const realExec: Exec = (program, args, options = {}) => {
  try {
    const r = spawnSyncFed(program, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.input !== undefined ? { input: options.input } : { stdio: ["ignore", "pipe", "pipe"] }),
    })
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ...(r.error ? { error: r.error.message } : {}) }
  } catch (e) {
    // Deno refuses a program the launcher did not grant by throwing.
    return { status: null, stdout: "", stderr: "", error: e instanceof Error ? e.message : String(e) }
  }
}

/** Who said yes, how, in which words, when: written into every receipt of the plan. */
export interface Consent {
  how: "asked on the terminal" | "given with --consent"
  by: string
  words: string
  at: string
}

/** The receipt beside an installed tool. */
export interface Receipt {
  tool: string
  version: string
  platform: string
  url: string
  sha256?: string
  size: number
  format: Source["format"]
  installedAt: string
  consent: Consent
}

const refuse = (msg: string): NaimaError => new NaimaError(msg)

/** Download `url` into `file`, refusing past `size` bytes; the bytes written and their sha256, each chunk's total told to `received`. */
export async function download(
  url: string,
  file: string,
  size: number,
  received: (bytes: number) => void = () => {},
): Promise<{ bytes: number; sha256: string }> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw refuse(`download of ${url} failed: HTTP ${res.status}`)
  const hash = createHash("sha256")
  const fd = openSync(file, "w")
  let bytes = 0
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.byteLength
      if (bytes > size) throw refuse(`download of ${url}: larger than the declared ${size} bytes — stopped, nothing installed`)
      hash.update(chunk)
      writeSync(fd, chunk)
      received(bytes)
    }
  } finally {
    closeSync(fd)
  }
  return { bytes, sha256: hash.digest("hex") }
}

/** The members of an `ar` archive (a .deb): name → bytes. A flat format: an 8-byte magic, then 60-byte headers each followed by its data, padded to even. */
export function readAr(bytes: Uint8Array): Map<string, Uint8Array> {
  const text = (from: number, to: number): string => new TextDecoder().decode(bytes.subarray(from, to))
  if (text(0, 8) !== "!<arch>\n") throw refuse("not an ar archive: the .deb does not start with !<arch>")
  const out = new Map<string, Uint8Array>()
  let at = 8
  while (at + 60 <= bytes.length) {
    const name = text(at, at + 16).trim().replace(/\/$/, "")
    const size = Number(text(at + 48, at + 58).trim())
    if (text(at + 58, at + 60) !== "`\n" || !Number.isInteger(size) || size < 0) throw refuse(`a malformed ar header at byte ${at}`)
    out.set(name, bytes.subarray(at + 60, at + 60 + size))
    at += 60 + size + (size % 2)
  }
  return out
}

const failed = (what: string, r: ExecResult): NaimaError =>
  refuse(
    `${what} failed (${r.error ?? `exit ${r.status}`})${r.stderr.trim() ? `: ${r.stderr.trim().split("\n").slice(-3).join(" ")}` : ""} — nothing installed`,
  )

/** Run a step; its result, or the refusal saying what failed. */
function step(exec: Exec, what: string, program: string, args: string[], options?: { cwd?: string; input?: string }): ExecResult {
  const r = exec(program, args, options)
  if (r.status !== 0) throw failed(what, r)
  return r
}

/** Run tar to unpack `archive` into `root`, in the form every tar takes as a local file (see tarCommand). */
function untar(exec: Exec, what: string, archive: string, root: string): ExecResult {
  const { args, cwd } = tarCommand(archive, root, ["-x"])
  return step(exec, what, "tar", args, { cwd })
}

/** Unpack `archive` into `root` by its format; `python` is the Python a pip source installs with. */
export function unpack(source: Source, archive: string, root: string, stage: string, exec: Exec, os: string, python: string | null): void {
  mkdirSync(root, { recursive: true })
  switch (source.format) {
    case "tar.gz":
      untar(exec, "unpacking with tar", archive, root)
      return
    case "zip":
      // bsdtar reads zip (macOS, Windows 10 and later); GNU tar does not, so Linux uses unzip.
      if (os === "linux") step(exec, "unpacking with unzip", "unzip", ["-q", archive, "-d", root])
      else untar(exec, "unpacking with tar", archive, root)
      return
    case "deb": {
      const members = readAr(readFileSync(archive))
      const data = [...members.keys()].find((n) => n.startsWith("data.tar"))
      if (!data) throw refuse("the .deb holds no data.tar — nothing installed")
      const inner = join(stage, data)
      writeFileSync(inner, members.get(data)!)
      untar(exec, "unpacking the .deb's data with tar", inner, root)
      return
    }
    case "dmg": {
      const mount = join(stage, "mnt")
      mkdirSync(mount, { recursive: true })
      // The image may ask to accept its licence agreement: the consent already given named that licence, so it is answered yes.
      step(exec, "mounting the image with hdiutil", "hdiutil", ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount, archive], {
        input: "Y\n",
      })
      try {
        const app = join(mount, source.app!)
        if (!existsSync(app)) throw refuse(`the image holds no ${source.app} — nothing installed`)
        // ditto, macOS's own copier, keeps the bundle's symlinks, modes and signature; Deno's cpSync cannot make a symlink inside the launcher's fence.
        step(exec, "copying the app out of the image with ditto", "ditto", [app, join(root, source.app!)])
      } finally {
        const r = exec("hdiutil", ["detach", mount])
        if (r.status !== 0) exec("hdiutil", ["detach", "-force", mount])
      }
      return
    }
    case "pip": {
      if (!python) throw refuse(`the Python it installs with (${source.python}) is not installed — nothing installed`)
      const venv = join(root, "venv")
      step(exec, "making the venv", python, ["-m", "venv", venv])
      const requirements = join(stage, "requirements.txt")
      writeFileSync(requirements, source.requirements!.join("\n") + "\n")
      const pythonIn = join(venv, os === "windows" ? "Scripts" : "bin", programFile("python", os))
      step(exec, "pip install (hash-checked, binary wheels only)", pythonIn, [
        "-m",
        "pip",
        "install",
        "--require-hashes",
        "--only-binary",
        ":all:",
        "--no-deps",
        "--disable-pip-version-check",
        "--no-input",
        "-r",
        requirements,
      ])
      return
    }
  }
}

/** Check an unpacked install: the declared program, run with its arguments, prints the declared string. */
export function verifyInstall(tool: ToolDeclaration, source: Source, root: string, exec: Exec, os: string): string {
  const program = join(root, source.bin, programFile(tool.verify.program, os))
  if (!existsSync(program)) throw refuse(`${tool.name}: ${program} is not in the unpacked install — nothing installed`)
  const r = exec(program, tool.verify.args)
  const said = `${r.stdout}\n${r.stderr}`
  if (r.status !== 0 || !said.includes(tool.verify.expect)) {
    throw refuse(
      `${tool.name}: the install does not run here — ${tool.verify.program} ${tool.verify.args.join(" ")} ${
        r.status !== 0 ? `failed (${r.error ?? `exit ${r.status}`})` : `did not print ${JSON.stringify(tool.verify.expect)}`
      }${said.trim() ? `: ${said.trim().split("\n").slice(-3).join(" ")}` : ""} — nothing installed`,
    )
  }
  return said.trim().split("\n")[0] ?? ""
}

/** Everything one install needs besides the tool: where, on which platform, with what, and the consent. */
export interface InstallRun {
  dir: string
  platform: string
  os: string
  exec: Exec
  consent: Consent
  /** The Python a pip source installs with, already installed; null when it is not. */
  python: string | null
  out(line: string): void
  /** Where the install reports its stages: the download in bytes, then unpack and verify (specs/progress-long-work-says-how-far, §6). */
  progress?: Progress
}

/** Install `tool` from `source` into `<dir>/<tool>/<version>`: the path, once verified and in place. */
export async function installTool(tool: ToolDeclaration, source: Source, run: InstallRun): Promise<string> {
  const progress = run.progress ?? NO_PROGRESS
  mkdirSync(run.dir, { recursive: true })
  const stage = join(run.dir, `.staging-${randomUUID()}`)
  const root = join(stage, "root")
  mkdirSync(stage)
  try {
    let archive = ""
    if (source.format !== "pip") {
      archive = join(stage, "download")
      run.out(`  ${tool.name}: downloading ${source.url}`)
      progress.stage(`${tool.name}: download`, source.size, "bytes")
      const got = await download(source.url, archive, source.size, (n) => progress.at(n))
      if (got.bytes !== source.size) throw refuse(`${tool.name}: downloaded ${got.bytes} bytes, the declaration says ${source.size} — nothing installed`)
      if (got.sha256 !== source.sha256) {
        throw refuse(`${tool.name}: the download's sha256 is ${got.sha256}, the declaration says ${source.sha256} — nothing installed`)
      }
      run.out(`  ${tool.name}: ${got.bytes} bytes, sha256 as declared`)
    } else run.out(`  ${tool.name}: pip install from ${source.url}, every requirement hash-checked`)
    progress.stage(`${tool.name}: unpack`)
    unpack(source, archive, root, stage, run.exec, run.os, run.python)
    progress.stage(`${tool.name}: verify`)
    const said = verifyInstall(tool, source, root, run.exec, run.os)
    run.out(`  ${tool.name}: verified — ${said}`)
    const receipt: Receipt = {
      tool: tool.name,
      version: tool.version,
      platform: run.platform,
      url: source.url,
      ...(source.sha256 ? { sha256: source.sha256 } : {}),
      size: source.size,
      format: source.format,
      installedAt: new Date().toISOString(),
      consent: run.consent,
    }
    writeFileSync(join(root, RECEIPT), JSON.stringify(receipt, null, 2) + "\n")
    const target = installDirOf(run.dir, tool)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(dirname(target), { recursive: true })
    renameSync(root, target)
    return target
  } finally {
    try {
      rmSync(stage, { recursive: true, force: true })
    } catch { /* an image hdiutil would not detach keeps its mount point, and the staging directory with it, until it is detached */ }
  }
}
