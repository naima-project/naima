// Moving a tracker committed with the code into a repository of its own:
// what `naima init --private-tracker` does on a project that already has one.
//
// The data and its history are kept: the new repository is a copy of the code
// repository's current branch, filtered to the data directory (git
// filter-branch --subdirectory-filter), so every commit that touched the
// tracker is there, with its author, date and message, and its last tree is
// the data directory's tree as committed. Nothing is deleted: the code
// repository stops tracking the data directory (git rm --cached, the files
// stay on disk) in one commit, and its history still holds every earlier
// version. The new repository has no remote: it stays on this machine.

import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { posixRelative } from "./config.ts"
import { gitOrNull, gitReason, runGit, trunk } from "./git.ts"
import { DATA_FILE } from "./layout.ts"
import { ignoreProgram } from "./program.ts"
import { HOOKS_DIR, installTrailerHooks, SIBLING_FILE, writeSiblingMarker } from "./repos.ts"

/** The folder, in the tracker folder, the history is filtered in before it moves into place; removed after. */
const WORK = ".naima-data-moving"

/**
 * Move the data directory `data`, committed in the code repository at `root`, into a git repository of its own
 * in place, history kept. Refused, with nothing changed, when the data has uncommitted changes, when the code is
 * not on its trunk, or when the filtered copy's tree is not the committed data's. `say` reports each step.
 */
export function moveTrackerOut(root: string, data: string, say: (line: string) => void): void {
  const tracker = dirname(data)
  const prefix = posixRelative(root, data)
  if (!existsSync(join(data, DATA_FILE)) || gitOrNull(root, "ls-files", "--error-unmatch", "--", `${prefix}/${DATA_FILE}`) === null) {
    throw new Error(`${prefix}/${DATA_FILE} is not committed in the code's repository: there is no tracker to move`)
  }
  const dirty = gitOrNull(root, "status", "--porcelain", "--", prefix) ?? ""
  if (dirty) {
    throw new Error(`${prefix} has uncommitted changes: commit them first (git add ${prefix} && git commit), then run naima init --private-tracker again`)
  }
  // The move is one commit of the code's whole index: nothing else may be staged in it.
  if (!runGit(root, ["diff", "--cached", "--quiet"]).ok) {
    throw new Error(`the code's repository has staged changes: commit or unstage them first, then run naima init --private-tracker again`)
  }
  const branch = gitOrNull(root, "rev-parse", "--abbrev-ref", "HEAD") ?? "HEAD"
  const main = trunk(root) ?? branch
  if (branch !== main) {
    throw new Error(`the code is on ${branch}: move the tracker from the main checkout, on ${main}, after landing or closing the other branches`)
  }
  const work = join(tracker, WORK)
  if (existsSync(work)) throw new Error(`${posixRelative(root, work)} is left from a move that did not finish: move it away, then run again`)
  const committed = gitOrNull(root, "rev-parse", `HEAD:${prefix}`)
  if (!committed) throw new Error(`cannot read ${prefix} at the code's HEAD`)

  say(`copying the tracker's history out of the code's repository (git filter-branch on ${main}): on a long history this takes minutes`)
  try {
    const clone = runGit(root, ["clone", "--quiet", "--no-local", "--single-branch", "--no-tags", "--branch", main, "--", root, work])
    if (!clone.ok) throw new Error(`cannot copy the code's repository: ${gitReason(clone)}`)
    const filtered = runGit(work, ["filter-branch", "-f", "--subdirectory-filter", prefix, "--", main], { env: { FILTER_BRANCH_SQUELCH_WARNING: "1" } })
    if (!filtered.ok) throw new Error(`git filter-branch failed: ${gitReason(filtered)}`)
    runGit(work, ["remote", "remove", "origin"])
    for (const ref of (gitOrNull(work, "for-each-ref", "--format=%(refname)", "refs/original") ?? "").split("\n").filter(Boolean)) {
      runGit(work, ["update-ref", "-d", ref])
    }
    const tree = gitOrNull(work, "rev-parse", "HEAD^{tree}")
    if (tree !== committed) throw new Error(`the copied history ends in tree ${tree}, not ${committed}, the committed data's: nothing was moved`)
  } catch (e) {
    rmSync(work, { recursive: true, force: true })
    throw e
  }

  // The code stops tracking the data, in one commit; the files stay where they are.
  const removed = runGit(root, ["rm", "-r", "-q", "--cached", "--", prefix])
  if (!removed.ok) {
    rmSync(work, { recursive: true, force: true })
    throw new Error(`git rm --cached ${prefix}: ${gitReason(removed)}`)
  }
  const ignore = ignoreProgram({ tracker, program: data })
  writeSiblingMarker(tracker, {})
  const paths = [prefix, posixRelative(root, join(tracker, SIBLING_FILE)), ...(ignore ? [posixRelative(root, ignore)] : [])]
  runGit(root, ["add", "--", ...paths.slice(1)])
  const commit = runGit(root, ["commit", "-q", "--no-verify", "-m", "Keep the tracker in a repository of its own"])
  if (!commit.ok) {
    runGit(root, ["reset", "-q", "--", ...paths])
    rmSync(work, { recursive: true, force: true })
    throw new Error(`cannot commit the change in the code's repository: ${gitReason(commit)} — nothing was moved`)
  }
  say(`the code's repository no longer tracks ${prefix} (commit ${gitOrNull(root, "rev-parse", "--short=12", "HEAD")}); its earlier history still holds it`)

  // The copy's git directory becomes the data directory's: its files are the committed ones, already there.
  mkdirSync(data, { recursive: true })
  renameSync(join(work, ".git"), join(data, ".git"))
  rmSync(work, { recursive: true, force: true })
  runGit(data, ["reset", "-q"])
  say(`${prefix} is now a git repository of its own, with its history, on this machine only: no remote, nothing public`)
  for (const line of installTrailerHooks(root, data)) say(line)
  runGit(data, ["add", "--", HOOKS_DIR])
  runGit(data, ["commit", "-q", "--no-verify", "-m", "Pair the tracker's commits with the code's", "--", HOOKS_DIR])
}
