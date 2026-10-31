// What the worker that resumes a dead or stuck one needs, in one read: the
// claim (its items and its last step), the commits the trunk lacks, what is
// not committed in its worktree, and the last entries of its agent transcript,
// which hold what it found or decided and never wrote down. The transcript is
// read through the agent tool's reader (core/adapters, TranscriptReader), only
// to continue the work: it is printed for the agent that asked, never written
// to a file, since the owner's chat stays private.

import { basename } from "node:path"
import {
  bool,
  type Command,
  type Context,
  gitOrNull,
  parse,
  positiveInt,
  str,
  type TranscriptEntry,
  trunk,
  usageError,
  workerTranscript,
  worktrees,
} from "../../core/api.ts"
import type { ClaimsData } from "./index.ts"
import { home } from "./worktrees.ts"

/** The transcript entries recover prints unless --tail says otherwise: the last steps and commands, and no more. */
export const TAIL = 12

/** The commits and not-committed paths recover lists at most: the rest is counted. */
const LIST = 10

export interface RecoverData {
  branch: string
  claim?: ClaimsData["claims"][number]
  worktree?: string
  trunk?: string
  /** The commits on the branch the trunk lacks, newest first: short hash and subject. */
  commits: string[]
  /** The paths not committed in its worktree, as git status gives them. */
  dirty: string[]
  /** The last entries of the worker's agent transcript: what the tool, and which file of it, they were read from. */
  transcript?: { tool: string; file: string; entries: TranscriptEntry[] }
}

/** Everything recover reports about `branch`, read from git, the claims and the agent tools' transcripts; nothing is written. */
export function recoverData(
  ctx: Context,
  branch: string,
  claims: ClaimsData,
  count: number,
  env: Record<string, string | undefined> = process.env,
): RecoverData {
  const claim = claims.claims.find((c) => c.branch === branch && !c.stale) ?? claims.claims.find((c) => c.branch === branch)
  const trees = worktrees(ctx.root)
  const tree = trees.find((w) => w.branch === branch)
  const main = trunk(ctx.root) ?? undefined
  const log = main ? gitOrNull(ctx.root, "log", "--format=%h %s", `${main}..refs/heads/${branch}`) : null
  const status = tree ? gitOrNull(tree.path, "status", "--porcelain", "--untracked-files=all") : null
  const transcript = workerTranscript(env, {
    ...(tree ? { worktree: tree.path } : {}),
    main: home(ctx.root, trees),
    branch,
    ...(claim ? { since: claim.claimedAt } : {}),
  }, count)
  return {
    branch,
    ...(claim ? { claim } : {}),
    ...(tree ? { worktree: tree.path } : {}),
    ...(main ? { trunk: main } : {}),
    commits: (log ?? "").split("\n").filter(Boolean),
    dirty: (status ?? "").split("\n").filter(Boolean),
    ...(transcript ? { transcript: { tool: transcript.tool, file: basename(transcript.file), entries: transcript.entries } } : {}),
  }
}

const listed = (lines: string[], what: string): string[] => [
  ...lines.slice(0, LIST).map((l) => `    ${l}`),
  ...(lines.length > LIST ? [`    … and ${lines.length - LIST} more ${what}`] : []),
]

const time = (at: string | undefined): string => (at && /T(\d\d:\d\d)/.exec(at)?.[1]) ?? "     "

export const recoverCommand = (read: (ctx: Context, branch: string) => ClaimsData): Command => {
  const cmd: Command = {
    name: "recover",
    says:
      "brief the worker that resumes a dead or stuck one: its claim and last step, the commits the trunk lacks, what is not committed in its worktree, and the last entries of its agent transcript",
    enforces:
      "nothing: it only reads; the transcript, found by the agent tool's reader, is printed only to continue the work and never written to a file, since the owner's chat stays private",
    usage: "recover <branch> [--tail <n>] [--json]",
    options: [
      { name: "--tail", says: `how many of the transcript's last entries to print (${TAIL} unless given): its last steps and commands, cut short` },
      { name: "--json", says: "print the same as JSON" },
    ],
    examples: ["recover worker/export-alpha", "recover worker/export-alpha --tail 30"],
    run(args, ctx) {
      const p = parse(args, { tail: { type: "string" }, json: { type: "boolean" } })
      const branch = p.positionals[0]
      if (!branch || p.positionals.length > 1) throw usageError(cmd)
      const d = recoverData(ctx, branch, read(ctx, branch), positiveInt(str(p, "tail"), TAIL, "recover --tail"))
      if (bool(p, "json")) {
        ctx.out(JSON.stringify(d, null, 2))
        return 0
      }
      ctx.out(`recover ${branch}: what the worker that resumes it needs`)
      const c = d.claim
      if (!c) ctx.out("  no claim names this branch")
      else {
        for (const e of c.items) ctx.out(`  ${e.ref}  ${e.title}`)
        if (c.step) ctx.out(`  last step: ${c.step.what} (${c.quietFor ?? 0} min ago)${c.silent ? " — possibly stuck" : ""}`)
        if (c.stale) ctx.out(`  stale: ${c.stale}`)
      }
      ctx.out(d.worktree ? `  worktree: ${d.worktree}` : "  no worktree stands on it")
      ctx.out(`  commits ${d.trunk ?? "the trunk"} lacks: ${d.commits.length}`)
      for (const l of listed(d.commits, "commits")) ctx.out(l)
      if (d.worktree) {
        ctx.out(`  not committed: ${d.dirty.length}${d.dirty.length ? " — read git status there first, and never discard it" : ""}`)
        for (const l of listed(d.dirty, "paths")) ctx.out(l)
      }
      if (!d.transcript) ctx.out("  no agent transcript found for it")
      else {
        ctx.out(
          `  the last ${d.transcript.entries.length} entries of its ${d.transcript.tool} transcript (${d.transcript.file}) — to continue the work only: never copy them into the repository`,
        )
        for (const e of d.transcript.entries) ctx.out(`    ${time(e.at)} ${e.kind.padEnd(6)} ${e.text}`)
      }
      return 0
    },
  }
  return cmd
}
