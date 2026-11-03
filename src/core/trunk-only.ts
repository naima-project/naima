// Tracker data is written only on the trunk. A checkout standing on a
// development line (the branch line/<gate>) or on a branch opened from one
// writes no tracker data of its own and never changes naima.json: items,
// notes, decisions, diary entries and Naima's settings are written on the
// trunk, and reach the line when it syncs. An item's own work travels with
// its code on the line, and is let through by the coordination plugin's write
// hook: its fixed mark, its test runs, its session note (docs/guide/lines.md).
// What makes a branch a line's is read from git alone, as the coordination
// plugin reads it: the branch line/<gate> that the trunk has not merged, or a
// branch carrying a commit of such a line that the trunk lacks.

import { NaimaError } from "./errors.ts"
import { currentBranch, gitOrNull, isAncestor, toplevel, trunk } from "./git.ts"
import { DATA_FILE } from "./layout.ts"

/** The branches of development lines are named line/<gate>. */
export const LINE_BRANCH_PREFIX = "line/"

/** Where a checkout stands, when that is a development line: the branch checked out, and the line's branch. */
export interface OnLine {
  branch: string
  line: string
}

const seen = new Map<string, OnLine | null>()

/**
 * The development line the checkout at `root` stands on: its own branch when that is an open line, else the open
 * line whose commits the trunk lacks and the branch carries; null on the trunk, on a branch of the trunk, on a
 * detached HEAD, and outside git. Kept per checkout, branch and commit for the life of the process.
 */
export function developmentLine(root: string): OnLine | null {
  const head = gitOrNull(root, "rev-parse", "--symbolic-full-name", "HEAD", "HEAD")
  if (head === null) return null
  const key = `${root}\0${head}\0${gitOrNull(root, "for-each-ref", "--format=%(objectname)", `refs/heads/${LINE_BRANCH_PREFIX}`) ?? ""}`
  if (seen.has(key)) return seen.get(key)!
  const found = lineOfCheckout(root)
  seen.set(key, found)
  return found
}

function lineOfCheckout(root: string): OnLine | null {
  const branch = currentBranch(root)
  if (branch === "HEAD") return null
  const main = trunk(root)
  if (!main || branch === main) return null
  const lines = (gitOrNull(root, "for-each-ref", "--format=%(refname:short)", "--no-merged", main, `refs/heads/${LINE_BRANCH_PREFIX}`) ?? "")
    .split("\n").filter(Boolean)
  if (lines.includes(branch)) return { branch, line: branch }
  for (const line of lines) {
    const base = gitOrNull(root, "merge-base", "HEAD", line)
    if (base && !isAncestor(root, base, main)) return { branch, line }
  }
  return null
}

/** Where the checkout stands, in words: "line/g", or "b, a branch of line/g". */
export const whereOnLine = (on: OnLine): string =>
  on.branch === on.line ? `the development line ${on.line}` : `${on.branch}, a branch of the development line ${on.line}`

/** The refusal of a tracker write made on a line: what it was, where it was made, and where to make it instead. */
export const trunkOnlyRefusal = (what: string, on: OnLine): string =>
  `${what} is tracker data, written only on the trunk, and this checkout is on ${
    whereOnLine(on)
  }: run it in the trunk's checkout, and the line gets it when it syncs (naima line sync) — on a line Naima writes only an item's own work: its fixed mark, its test runs, its session note`

/**
 * Refuse a write of naima.json in the data directory `data` when its checkout stands on a development line: Naima's
 * settings (the lock, the gates, the options) are the trunk's alone. Throws a NaimaError that says so.
 */
export function refuseConfigOnLine(data: string): void {
  const root = toplevel(data)
  const on = root ? developmentLine(root) : null
  if (on) throw new NaimaError(trunkOnlyRefusal(`a change to ${DATA_FILE}`, on), "vetoed")
}
