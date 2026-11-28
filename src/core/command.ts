// The naima command: one small program for the user, without administrator rights, that runs the Naima of the project it
// is typed in (that project's naima-tracker launcher, with its own locked Naima). naima hello installs it when it is
// missing, as the installers do: on macOS and Linux a script in ~/.local/bin, on Windows naima.cmd in the user's own
// programs folder, which it adds to the user's PATH. A naima command that is not Naima's is left alone.

import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** The POSIX command: finds the project's root with git and runs its launcher. */
export const POSIX_COMMAND = `#!/bin/sh
# naima: runs the Naima of the project this folder is in, through that project's own launcher (naima-tracker/naima.sh).
root=$(git rev-parse --show-toplevel 2>/dev/null) || root=""
if [ -n "$root" ] && [ -f "$root/naima-tracker/naima.sh" ]; then exec sh "$root/naima-tracker/naima.sh" "$@"; fi
echo "naima: this folder is in no project that uses Naima. To install Naima in a project, from its folder:" >&2
echo "    curl -fsSL https://naima-project.github.io/naima/install.sh | sh" >&2
exit 2
`

/** The Windows command, for cmd: the same, through the project's naima.cmd. */
export const WINDOWS_COMMAND = [
  "@echo off",
  "rem naima: runs the Naima of the project this folder is in, through that project's own launcher (naima-tracker\\naima.cmd).",
  'set "NAIMA_ROOT="',
  'for /f "delims=" %%r in (\'git rev-parse --show-toplevel 2^>nul\') do set "NAIMA_ROOT=%%r"',
  'if defined NAIMA_ROOT if exist "%NAIMA_ROOT%\\naima-tracker\\naima.cmd" (',
  '  call "%NAIMA_ROOT%\\naima-tracker\\naima.cmd" %*',
  "  exit /b %errorlevel%",
  ")",
  "echo naima: this folder is in no project that uses Naima. To install Naima in a project, from its folder: 1>&2",
  "echo     irm https://naima-project.github.io/naima/install.ps1 ^| iex 1>&2",
  "exit /b 2",
  "",
].join("\r\n")

/** The folder the command goes in: NAIMA_BIN when set, else ~/.local/bin, or the user's programs folder on Windows. */
export function commandDir(env: Record<string, string | undefined>, os: string): string {
  if (env["NAIMA_BIN"]) return env["NAIMA_BIN"]
  if (os === "windows") return join(env["LOCALAPPDATA"] ?? join(env["USERPROFILE"] ?? "", "AppData", "Local"), "Programs", "naima")
  return join(env["HOME"] ?? "", ".local", "bin")
}

/** The command's file in `dir`. */
export const commandFile = (dir: string, os: string): string => join(dir, os === "windows" ? "naima.cmd" : "naima")

/** Whether `dir` is one of PATH's folders. */
const onPath = (dir: string, env: Record<string, string | undefined>, os: string): boolean =>
  (env["PATH"] ?? env["Path"] ?? "").split(os === "windows" ? ";" : ":").some((d) => d.replace(/[\\/]+$/, "") === dir.replace(/[\\/]+$/, ""))

/**
 * Install the naima command when it is missing or Naima's own is older: what was done, in one line, or null when there was
 * nothing to do. `addToPath` puts the folder on the user's PATH on Windows, unless NAIMA_BIN named it; otherwise the
 * line to add is said.
 */
export function ensureCommand(
  env: Record<string, string | undefined>,
  os: string,
  addToPath: (dir: string) => boolean = (dir) => addToUserPath(dir),
): string | null {
  const dir = commandDir(env, os)
  if (!dir) return null
  const file = commandFile(dir, os)
  const text = os === "windows" ? WINDOWS_COMMAND : POSIX_COMMAND
  const mark = os === "windows" ? "naima-tracker\\naima.cmd" : "naima-tracker/naima.sh"
  if (existsSync(file)) {
    const was = readFileSync(file, "utf8")
    if (!was.includes(mark)) return null // not Naima's: left alone
    if (was === text) return null
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, text)
  if (os !== "windows") chmodSync(file, 0o755)
  if (onPath(dir, env, os)) return `installed the naima command in ${dir}`
  // A folder named by NAIMA_BIN is the person's own choice, and so is whether it is on their PATH: it is never added.
  if (os === "windows" && !env["NAIMA_BIN"]) {
    return addToPath(dir)
      ? `installed the naima command in ${dir}, now on your PATH: a new terminal has it`
      : `installed the naima command in ${dir}; add that folder to your PATH to use it`
  }
  if (os === "windows") return `installed the naima command in ${dir}; add that folder to your PATH to use it`
  return `installed the naima command in ${dir}, which is not on your PATH: add export PATH="${dir}:$PATH" to your shell's profile`
}

/** Add `dir` to the user's own PATH on Windows (no administrator): whether it was done. */
export function addToUserPath(dir: string): boolean {
  const script = `$p=[Environment]::GetEnvironmentVariable('Path','User'); if (-not (($p -split ';') -contains '${
    dir.replace(/'/g, "''")
  }')) { [Environment]::SetEnvironmentVariable('Path', ($(if ($p) { "$p;" } else { '' }) + '${dir.replace(/'/g, "''")}'), 'User') }`
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore", timeout: 20_000 })
  return r.status === 0
}
