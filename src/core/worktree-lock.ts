// A worktree that runs another Naima than the trunk's, or whose program is not
// a clone of its own: Naima moves nothing there, and hello and the long
// commands print a prompt to give a conversation on the main checkout, which
// is where the fix is decided (docs/guide/install.md#worktrees-and-the-lock).
//
// Moving the program in such a worktree is what pulled one clone between
// several locks: a worktree whose program was a link to the trunk's moved the
// trunk's clone to the worktree's older lock, and a worktree whose branch never
// took the trunk's newer lock kept running the older Naima, unsaid.

import { dirname, join, resolve } from "node:path"
import { posixRelative } from "./config.ts"
import { currentBranch, nativePath, runGit, trunk } from "./git.ts"
import { DATA_FILE } from "./layout.ts"
import { linkOf, short } from "./program.ts"

/** The commands that print the prompt: hello, and those that run long on the program they are given. */
export const PROMPTED = new Set(["hello", "verify", "run"])

/** Why the program of a worktree is held, with the prompt that says how to fix it; null when it is aligned as usual. */
export interface Hold {
  prompt: string
}

/** The main checkout of the repository at `root`, when `root` is another worktree of it; else null. */
function mainCheckout(root: string): string | null {
  // One git process for both, so the two paths are spelled alike; never resolved here, since they are outside what Naima may read.
  const r = runGit(root, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"])
  const [dir, common] = r.ok ? r.out.split("\n") : []
  if (!dir || !common || resolve(nativePath(dir)) === resolve(nativePath(common))) return null
  return dirname(resolve(nativePath(common)))
}

/** The commit the trunk's lock names, read from git: the main checkout is outside what Naima may read. */
function trunkLock(root: string, data: string, branch: string): string | null {
  const shown = runGit(root, ["show", `${branch}:${posixRelative(root, join(data, DATA_FILE))}`])
  if (!shown.ok) return null
  try {
    const commit = (JSON.parse(shown.out) as { commit?: unknown }).commit
    return typeof commit === "string" ? commit : null
  } catch {
    return null
  }
}

/** A commit as people name it: its version tag when it has one, with its short hash. */
function named(repo: string, commit: string): string {
  const tag = runGit(repo, ["describe", "--tags", "--exact-match", commit]).out
  return tag ? `${tag} (${short(commit)})` : short(commit)
}

/**
 * Whether the program of the worktree at `root` is held, and the prompt that says why and how to fix it: its
 * program is a link rather than a clone of its own, or its lock names another commit than the trunk's.
 * Null in the main checkout, and in a worktree that locks the trunk's commit in a clone of its own.
 */
export function worktreeHold(t: { root: string; data: string; program: string; commit: string }): Hold | null {
  const main = mainCheckout(t.root)
  if (!main) return null
  const branch = currentBranch(t.root)
  const trunkName = trunk(t.root) ?? "main"
  const at = posixRelative(main, t.root)
  const program = posixRelative(t.root, t.program)
  const link = linkOf(t)
  const head = runGit(t.root, ["-C", t.program, "rev-parse", "HEAD"]).out
  const theirs = trunkLock(t.root, t.data, trunkName)
  const repo = link?.target ?? t.program
  const mine = named(repo, t.commit)
  const trunks = theirs ? named(repo, theirs) : null
  const lines: string[] = []
  if (link) {
    lines.push(
      `naima: this worktree (${at}, branch ${branch}) runs the program ${program}, a link to ${
        posixRelative(t.root, link.target)
      }, not a clone of its own: it is at ${head ? named(repo, head) : "no commit"}, this worktree's lock names ${mine}${
        trunks ? `, the trunk (${trunkName}) is on ${trunks}` : ""
      }. Naima moved nothing. Give this to a conversation on the main checkout:`,
      "",
      `  In the main checkout of this repository, fix the worktree at ${at} (branch ${branch}): its ${program} is a link to ${
        posixRelative(main, link.target)
      }${
        link.shared ? ", the program of another checkout, which every run there moved to its own lock" : ""
      }. Replace the link with a clone of its own: remove the link ${at}/${program} (the link only, not what it points to), then run sh ${at}/${
        posixRelative(t.root, dirname(t.data))
      }/naima.sh hello from ${at}, which clones the program at that worktree's lock, ${mine}.${
        theirs && theirs !== t.commit ? ` Then bring the branch to the trunk's Naima, ${trunks}: merge ${trunkName} into ${branch}.` : ""
      }`,
    )
    return { prompt: lines.join("\n") }
  }
  if (!theirs || theirs === t.commit) return null
  const newer = runGit(t.root, ["-C", t.program, "merge-base", "--is-ancestor", theirs, t.commit]).ok
  lines.push(
    `naima: this worktree (${at}, branch ${branch}) runs Naima ${mine}; the trunk (${trunkName}) is on ${trunks}. Naima moved nothing. Give this to a conversation on the main checkout:`,
    "",
    newer
      ? `  In the main checkout of this repository, the worktree at ${at} (branch ${branch}) locks Naima ${mine}, newer than the trunk's ${trunks}: if that update is meant to land, merge ${trunkName} into ${branch}, then land ${branch} with naima land; if not, merge ${trunkName} into ${branch} and keep the trunk's lock, ${trunks}.`
      : `  In the main checkout of this repository, the worktree at ${at} (branch ${branch}) still locks Naima ${mine}, older than the trunk's ${trunks}: merge ${trunkName} into ${branch} in that worktree, so its lock becomes ${trunks}, then run naima hello there, which moves its own clone to it; if ${branch} is finished, land it with naima land after that merge.`,
  )
  return { prompt: lines.join("\n") }
}
