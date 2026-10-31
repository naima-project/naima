// Commit messages carry no private infrastructure. A merge made from a local
// path with git's default message names that path — a home directory, with the
// user name in it — and once pushed it stays in the history for good. So
// `naima land` reads the message of every commit it is about to put on the
// trunk, the project's and those a moved submodule pointer brings, and the
// pre-push hook the trunk guard installs runs `naima push-check`, which reads
// every commit a push sends. Both use the patterns of the tracker's privacy
// check; a commit already on a remote is never read again, since it cannot be
// reworded without rewriting what was published.

import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  type Command,
  type Context,
  findPrivate,
  gitOrNull,
  KEEP_REASON,
  KINDS,
  NaimaError,
  parse,
  privateContext,
  type PrivateFinding,
  runGit,
  str,
  usageError,
} from "../../core/api.ts"
import { gitlinks } from "./changes.ts"

/** The merge that brings the product's main into a branch without naming a local path. */
export const PATH_FREE_MERGE = 'git fetch <checkout> main, then git merge --no-ff -m "Merge product main" FETCH_HEAD'

/** A commit whose message holds private infrastructure: where, which commit, and what was found. */
export interface MessageLeak {
  /** The repository's path in the project, with a slash, or "" for the project itself. */
  prefix: string
  sha: string
  subject: string
  findings: PrivateFinding[]
}

const ZERO = /^0+$/

/** Every commit `range` (git log arguments) names in `repo` whose message holds private infrastructure, oldest first. */
export function leakyMessages(repo: string, range: string[], prefix = ""): MessageLeak[] {
  const out = gitOrNull(repo, "log", "--reverse", "--format=%H%x1f%B%x1e", ...range) ?? ""
  const priv = privateContext()
  const leaks: MessageLeak[] = []
  for (const record of out.split("\x1e")) {
    const [sha = "", body = ""] = record.replace(/^\n/, "").split("\x1f")
    if (!sha) continue
    const findings = findPrivate(body, priv)
    if (findings.length) leaks.push({ prefix, sha, subject: body.split("\n")[0] ?? "", findings })
  }
  return leaks
}

/** Whether `repo` holds the commit `sha`. */
const holds = (repo: string, sha: string): boolean => runGit(repo, ["cat-file", "-e", `${sha}^{commit}`]).ok

/** The commits a push of `local` over `remote` sends, as git log arguments: those no remote-tracking branch holds when the remote's tip is new or unknown here. */
export function pushedRange(repo: string, local: string, remote: string): string[] | null {
  if (ZERO.test(local)) return null // a deletion sends nothing
  if (ZERO.test(remote) || !holds(repo, remote)) return [local, "--not", "--remotes"]
  return [`${remote}..${local}`]
}

/**
 * The commits a landing from `old` to `tip` puts on the trunk whose message holds private infrastructure: the
 * project's own, and in each submodule checked out whose pointer moves, those its new pointer brings that no
 * remote-tracking branch of it holds yet.
 */
export function landingLeaks(root: string, old: string, tip: string): MessageLeak[] {
  const leaks = leakyMessages(root, [`${old}..${tip}`])
  const before = gitlinks(root, old)
  for (const [path, next] of gitlinks(root, tip)) {
    const dir = join(root, path)
    const prev = before.get(path)
    if (prev === next || !existsSync(join(dir, ".git")) || !holds(dir, next)) continue
    const from = prev && holds(dir, prev) ? [`^${prev}`] : []
    leaks.push(...leakyMessages(dir, [next, ...from, "--not", "--remotes"], `${path}/`))
  }
  return leaks
}

/** The refusal that lists each leaky message with what replaces each finding, and how to go on. */
export function messagesRefusal(what: string, leaks: MessageLeak[], escape: string): string {
  const lines = leaks.flatMap((l) =>
    l.findings.map((f) =>
      `  ${l.prefix}${l.sha.slice(0, 12)} "${l.subject}", line ${f.line}: ${KINDS[f.kind].says} ${JSON.stringify(f.text)} — write ${KINDS[f.kind].placeholder}`
    )
  )
  return [
    `${what}: commit messages hold private infrastructure, which no repository carries:`,
    ...lines,
    `Reword each before it leaves this clone (git commit --amend for the last one, an interactive rebase for an older one, on a branch nothing published yet). ` +
    `A merge of the product's main into a branch is made path-free: ${PATH_FREE_MERGE}. ${escape}`,
  ].join("\n")
}

/** Refuse a landing whose commits carry private infrastructure in their messages, unless --allow-private gives the reason. */
export function guardLandingMessages(ctx: Context, branch: string, old: string, tip: string): void {
  const leaks = landingLeaks(ctx.root, old, tip)
  if (!leaks.length) return
  // A project that keeps private data in its tracker still keeps it out of its code's history.
  const allowed = ctx.allowPrivate !== undefined && ctx.allowPrivate !== KEEP_REASON
  if (allowed) {
    ctx.out(`${leaks.length} commit message(s) of ${branch} hold private infrastructure, landed on purpose (--allow-private): ${ctx.allowPrivate}`)
    return
  }
  throw new NaimaError(
    messagesRefusal(`nothing landed: ${branch}`, leaks, `A deliberate mention lands with --allow-private "<reason>".`),
    "private",
  )
}

export const pushCheckCommand: Command = {
  name: "push-check",
  says:
    "what the trunk guard's pre-push hook runs: exit 0 when no commit the push sends carries private infrastructure in its message, else each one with what to write instead",
  enforces:
    "a push is refused when a commit it sends — one the remote's tip does not hold, or no remote-tracking branch holds when that tip is new or unknown here — has a home-directory path, a machine or user name, an IP address, a URI with a port or a word of the private list in its message; a deletion sends nothing; git push --no-verify skips the hook, on the owner's word",
  usage: "push-check [--repo <dir>] (<local sha> <remote sha>)...",
  examples: ["push-check 4567def 0123abc", "push-check --repo naima 4567def 0000000000000000000000000000000000000000"],
  options: [{ name: "--repo", says: "the repository the push is from, when it is not the project's own: a submodule", default: "the project root" }],
  hook: true,
  run(args, ctx) {
    const p = parse(args, { repo: { type: "string" } })
    const pairs = p.positionals
    if (pairs.length % 2) throw usageError(this)
    const repo = str(p, "repo") ?? ctx.root
    const leaks: MessageLeak[] = []
    for (let i = 0; i < pairs.length; i += 2) {
      const range = pushedRange(repo, pairs[i] ?? "", pairs[i + 1] ?? "")
      if (range) leaks.push(...leakyMessages(repo, range))
    }
    if (!leaks.length) return 0
    ctx.err(`naima: ${messagesRefusal("nothing pushed", leaks, "Only the owner sends a deliberate mention, with git push --no-verify.")}`)
    return 1
  },
}
