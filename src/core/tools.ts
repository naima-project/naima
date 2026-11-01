// Where the tools plugins declare are installed on this machine, and where an
// installed tool's programs are: one directory per user and machine, never
// the system, never PATH (specs/tools-plugin-declares-tools-needs-naima-tools,
// §2 and §5). The launcher and the program both compute it, through this one
// module, so the launcher can grant every command reading it and `naima tools`
// alone writing it.

import { existsSync } from "node:fs"
import { isAbsolute, join, posix, win32 } from "node:path"

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
