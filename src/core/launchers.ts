// The committed launchers: naima.sh (macOS, Linux, Git Bash), naima.ps1 and naima.cmd (Windows), in the
// tracker folder beside the program and committed with the project, so that a fresh clone on a machine with
// no Deno and no program (a new cloud session) still runs Naima: each repairs what is missing — Deno, pinned
// by version and checksum, into the gitignored .bin/ beside them; the program from the lock — and then runs
// Naima. Every hook Naima installs runs naima.sh. `naima init` and `naima update` write them from this
// program's own copies (launchers/), and `naima check` notes one that is missing or differs.

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { posixRelative } from "./config.ts"

/** The launchers, by file name, as they are written into the tracker folder. */
export const LAUNCHERS = ["naima.sh", "naima.ps1", "naima.cmd"] as const

/** The POSIX launcher every hook runs. */
export const SH_LAUNCHER = "naima.sh"

/** The gitignored folder, beside the launchers, that a launcher installs Deno into. */
export const BIN_DIR = ".bin"

/** This program's copy of a launcher: what the tracker folder's must equal. */
export const launcherText = (name: string): string => readFileSync(fileURLToPath(new URL(`./launchers/${name}`, import.meta.url)), "utf8")

/** The launchers of the tracker folder that are missing or differ from this program's. */
export function staleLaunchers(tracker: string): string[] {
  return LAUNCHERS.filter((name) => {
    const path = join(tracker, name)
    return !existsSync(path) || readFileSync(path, "utf8") !== launcherText(name)
  })
}

/** The tracker's .gitignore line for the Deno a launcher installs. */
const BIN_LINE = `/${BIN_DIR}/`

/** Whether the tracker's .gitignore ignores the launchers' Deno. */
const binIgnored = (tracker: string): boolean => {
  const path = join(tracker, ".gitignore")
  return existsSync(path) && readFileSync(path, "utf8").split("\n").includes(BIN_LINE)
}

/**
 * Write the launchers that are missing or differ, and the .gitignore line for their Deno. Returns the files
 * written, relative to `root`, and one plain sentence for them; nothing when all are current.
 */
export function writeLaunchers(root: string, tracker: string): { wrote: string[]; said: string[] } {
  const stale = staleLaunchers(tracker)
  const wrote: string[] = []
  for (const name of stale) {
    const path = join(tracker, name)
    writeFileSync(path, launcherText(name))
    if (name === SH_LAUNCHER) chmodSync(path, 0o755)
    wrote.push(posixRelative(root, path))
  }
  if (!binIgnored(tracker)) {
    const path = join(tracker, ".gitignore")
    const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l !== "") : []
    writeFileSync(path, [...lines, BIN_LINE].join("\n") + "\n")
    wrote.push(posixRelative(root, path))
  }
  if (!stale.length) return { wrote, said: [] }
  const shown = stale.map((n) => posixRelative(root, join(tracker, n))).join(", ")
  return {
    wrote,
    said: [
      `Wrote ${shown}: the launchers every Naima hook runs, which on a machine with no Deno or no program, such as a fresh clone in a new cloud session, install the pinned Deno and restore the locked program before running Naima.`,
    ],
  }
}

/** What the launchers lack, as naima check says it; nothing when they are current. */
export function launcherGaps(root: string, tracker: string): string[] {
  const stale = staleLaunchers(tracker)
  const out = stale.length
    ? [
      `${
        stale.map((n) => posixRelative(root, join(tracker, n))).join(", ")
      } missing or out of date: the launchers that repair a missing Deno or program before running Naima — naima update writes them`,
    ]
    : []
  if (!binIgnored(tracker)) {
    out.push(`${posixRelative(root, join(tracker, ".gitignore"))} does not ignore ${BIN_LINE}, where a launcher installs Deno: naima update adds it`)
  }
  return out
}
