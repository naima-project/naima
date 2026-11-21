// Where the tools plugins declare are installed on this machine, and where an
// installed tool's programs are: one directory per user and machine, never
// the system, never PATH (specs/tools-plugin-declares-tools-needs-naima-tools,
// §2 and §5). The launcher and the program both compute it, through this one
// module, so the launcher can grant every command reading it and `naima tools`
// alone writing it.

import { existsSync, statSync } from "node:fs"
import { delimiter, dirname, isAbsolute, join, posix, win32 } from "node:path"

/** The platforms a tool declaration names, as `<os>-<arch>`. */
export const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64"] as const

/** The receipt an install writes beside the tool: what was installed, from where, with whose consent. */
export const RECEIPT = "naima-tool.json"

/** The operating system as the tools directory and the platform keys name it: `win32` (Node) and `windows` (Deno) are `windows`. */
const osOf = (os: string): string => (os === "win32" ? "windows" : os)

/** This machine's platform key, `<os>-<arch>`: `darwin-arm64`, `linux-x64`, `windows-x64`… */
export function platformKey(os: string = process.platform, arch: string = process.arch): string {
  const a = arch === "x86_64" || arch === "amd64" ? "x64" : arch === "aarch64" ? "arm64" : arch
  return `${osOf(os)}-${a}`
}

/**
 * The tools directory: `$NAIMA_TOOLS` when it names an absolute path; otherwise
 * `~/Library/Application Support/naima/tools` on macOS,
 * `$XDG_DATA_HOME/naima/tools` (default `~/.local/share/naima/tools`) on
 * Linux, `%LOCALAPPDATA%\naima\tools` on Windows. Null when the environment
 * names no home to put it in.
 */
export function toolsDir(env: Record<string, string | undefined> = process.env, os: string = process.platform): string | null {
  const own = env["NAIMA_TOOLS"]
  if (own && isAbsolute(own)) return own
  const o = osOf(os)
  // Paths in the form of the system asked about, whatever system this runs on.
  const at = o === "windows" ? win32.join : posix.join
  if (o === "windows") {
    const local = env["LOCALAPPDATA"] ?? (env["USERPROFILE"] ? at(env["USERPROFILE"], "AppData", "Local") : undefined)
    return local ? at(local, "naima", "tools") : null
  }
  const home = env["HOME"]
  if (o === "darwin") return home ? at(home, "Library", "Application Support", "naima", "tools") : null
  const data = env["XDG_DATA_HOME"] && isAbsolute(env["XDG_DATA_HOME"]) ? env["XDG_DATA_HOME"] : home ? at(home, ".local", "share") : null
  return data ? at(data, "naima", "tools") : null
}

/** A program's file name on `os`: Windows adds `.exe`. */
export const programFile = (name: string, os: string = process.platform): string => (osOf(os) === "windows" ? `${name}.exe` : name)

/** What of a tool declaration finding an installed program needs: its name, version, and each platform's `bin`. */
export interface InstalledToolRef {
  name: string
  version: string
  platforms: Record<string, { bin?: string } | { unavailable: string }>
}

/** Where `tool` at its pinned version is installed on this machine: `<dir>/<name>/<version>`, whether or not it is there. */
export const installDirOf = (dir: string, tool: { name: string; version: string }): string => join(dir, tool.name, tool.version)

/**
 * The absolute path of `program`, one of `tool`'s, in its pinned version
 * installed on this machine, or null when it is not installed here: no
 * receipt, or no such program. What a plugin uses before PATH.
 */
export function installedProgram(tool: InstalledToolRef, program: string): string | null {
  const dir = toolsDir()
  const source = tool.platforms[platformKey()]
  if (!dir || !source || "unavailable" in source) return null
  try {
    const root = installDirOf(dir, tool)
    if (!existsSync(join(root, RECEIPT))) return null
    const path = join(root, source.bin ?? "", programFile(program))
    return existsSync(path) ? path : null
  } catch {
    // A command the launcher did not let read the tools directory: nothing is installed, as far as it can see.
    return null
  }
}

/** Where naima-codegen comes from: Naima does not install it (`naima tools` has no package of it). */
export const CODEGEN_SOURCE = "https://github.com/naima-project/naima-codegen"

/** What to do when naima-codegen is not found, said to a person (develop/models-tab.md §15). */
export const CODEGEN_MISSING = `naima-codegen is not installed, and Naima does not install it. To install it, clone ${CODEGEN_SOURCE} into a folder ` +
  "named naima-codegen beside this project (or beside a folder above it), or anywhere and set NAIMA_CODEGEN to its naima-codegen file " +
  "before starting naima ui. It needs Python 3.11 or later and the mCRL2 tools (naima tools install mcrl2)."

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * naima-codegen's program on this machine, or null: NAIMA_CODEGEN when it names a file; else naima-codegen on PATH (on
 * Windows its .exe or .com first); else a checkout in Naima's tools directory (`<tools>/naima-codegen/naima-codegen`);
 * else a checkout named naima-codegen beside `root` or beside a folder above it, as a workshop keeps one. The launcher
 * computes it for naima ui, which may not read the folders of PATH, and hands it on as NAIMA_CODEGEN.
 */
export function findCodegen(root: string, env: Record<string, string | undefined> = process.env, os: string = process.platform): string | null {
  const named = env["NAIMA_CODEGEN"]
  if (named && isAbsolute(named) && isFile(named)) return named
  const names = osOf(os) === "windows" ? ["naima-codegen.exe", "naima-codegen.com", "naima-codegen"] : ["naima-codegen"]
  for (const name of names) {
    for (const dir of (env["PATH"] ?? env["Path"] ?? "").split(osOf(os) === "windows" ? ";" : delimiter)) {
      if (dir && isFile(join(dir, name))) return join(dir, name)
    }
  }
  const tools = toolsDir(env, os)
  if (tools && isFile(join(tools, "naima-codegen", "naima-codegen"))) return join(tools, "naima-codegen", "naima-codegen")
  for (let dir = root;; dir = dirname(dir)) {
    const beside = join(dirname(dir), "naima-codegen", "naima-codegen")
    if (dirname(dir) !== dir && isFile(beside)) return beside
    if (dirname(dir) === dir) return null
  }
}
