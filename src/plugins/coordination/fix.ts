// naima fix: one command takes a small fix from filing to landing. Run by the
// coordinator on the main checkout, on the trunk, it files the item, opens its
// worktree, commits the change there and lands it; run by a worker on its
// branch, it files, commits and hands the branch over. It chains the normal
// steps and stops where the normal path stops: a landing refused because the
// trunk moved merges the trunk into the branch and is tried once more; any
// other refusal once the worktree is open leaves the branch, the worktree, the
// commits and the claim in place, records the reason of a refused landing on
// the item, and says what to do next; a later run for the same title takes up
// that branch and worktree. The protocol is the model
// develop/models/small-fix/fix.mcrl2, verified before this code.

import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  appliesTo,
  type Command,
  type Context,
  currentBranch,
  filerRole,
  gitOrNull,
  isAncestor,
  isOpen,
  type Item,
  label,
  message,
  mustGit,
  parse,
  posixRelative,
  str,
  today,
  trunk,
  usageError,
  worktrees,
  writeJson,
} from "../../core/api.ts"
import { type Policy, SEGMENT, SEGMENT_SAYS } from "./worktrees.ts"

/** What `fix` needs of `open`: the worktree, its branch and the claim file, as `open` makes them. */
export type OpenWork = (
  ctx: Context,
  policy: Policy,
  items: Item[],
  who: string,
  what: string,
) => { path: string; branch: string; claimFile: string }

/** The paths `git status` lists in `root` as changed or new, from the root, with forward slashes. */
function changedPaths(root: string): string[] {
  const out = gitOrNull(root, "status", "--porcelain=v1", "-z", "--untracked-files=all") ?? ""
  const entries = out.split("\0").filter(Boolean)
  const paths: string[] = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!
    paths.push(e.slice(3))
    // A rename or a copy names its source in the next entry.
    if (e[0] === "R" || e[0] === "C") i++
  }
  return paths
}

const inside = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`)

/** Run another command through the registry, as the command line would, on `ctx`; a refusal is thrown, an exit code other than 0 too. */
async function run(ctx: Context, name: string, ...args: string[]): Promise<void> {
  const cmd = ctx.registry.commands.get(name)
  if (!cmd) throw new Error(`fix needs the command ${name}, which no plugin loaded here provides`)
  ctx.reload()
  const code = await cmd.run(args, ctx)
  ctx.reload()
  if (code !== 0) throw new Error(`naima ${name} ended with exit code ${code}`)
}

/**
 * The item a retry reuses: one of `type` with exactly `title`, open and not fixed, which an earlier run of fix filed
 * before it stopped; none, and the item is filed anew.
 */
function filedBefore(ctx: Context, type: string, title: string): Item | undefined {
  return ctx.repo.items.find((i) => i.type === type && i.meta.title === title && isOpen(ctx, i) && !i.meta["fixedOn"])
}

/** File the item through `naima new`, every write hook included, and return it; an earlier run's item is reused. */
async function file(ctx: Context, type: string, title: string, asked: string | undefined): Promise<Item> {
  const earlier = filedBefore(ctx, type, title)
  if (earlier) {
    ctx.out(`reusing ${label(earlier)}, filed by an earlier run of fix that stopped`)
    return earlier
  }
  const before = new Set(ctx.repo.items.map((i) => i.meta.id))
  await run(ctx, "new", type, title, ...(asked ? ["--asked-by", asked] : []))
  const item = ctx.repo.items.find((i) => !before.has(i.meta.id))
  if (!item) throw new Error("naima new wrote no item")
  return item
}

export function fixCommand(policy: Policy, openWork: OpenWork): Command {
  return {
    name: "fix",
    says:
      "take a small fix from filing to landing in one step, as the normal steps would: on the main checkout, on the trunk, file the item, open its worktree, move the change there, commit it and land it; on a worker's branch, file the item, commit the change on the branch and hand it over to the coordinator",
    enforces:
      "the change is what the checkout holds uncommitted outside the tracker data, and there must be one unless an earlier run left the item's branch; the item's type has fixedOn, which is set on the branch; the command releases its own claim before a landing and before a run ends done; a worker's run never touches the trunk; the coordinator's commits on the trunk are the new item (tracker data only) and the landing marker; who works is --as, the coordination plugin's who option, or coordinator when an agent runs it on the trunk, and otherwise it refuses before writing anything; a coordinator's run stops where the normal path stops: a landing refused because the trunk moved merges the trunk into the branch and is tried once more, and any other refusal once the worktree is open leaves the branch, the worktree, what was committed and the claim in place, records the reason of a refused landing on the item, committed on the branch, and says what to do next; a later run for the same title takes up that branch and worktree instead of opening new ones",
    usage: 'fix "<title>" [--type <type>] [--message "<commit message>"] [--as <who>] [--asked-by <role>] [--no-change-note "<reason>"]',
    options: [
      { name: "--type", says: "the item's type: one with fixedOn", default: "bugs" },
      { name: "--message", says: "the commit message of the change", default: "the item's title" },
      {
        name: "--as",
        says: "who works, for the coordinator's branch: its first segment",
        default: policy.who ?? "coordinator, when an agent runs it on the trunk",
      },
      { name: "--asked-by", says: "who asked for it, recorded in the item's origin, as naima new takes it", default: "agent" },
      { name: "--no-change-note", says: "why the fix changes behaviour paths with no change note, passed to naima land" },
    ],
    examples: [
      'fix "The board drops the last column" --asked-by owner',
      'fix "A typo in the help of naima land" --no-change-note "a typo in a help line"',
    ],
    async run(args, ctx) {
      const p = parse(args, {
        type: { type: "string" },
        message: { type: "string" },
        as: { type: "string" },
        "asked-by": { type: "string" },
        "no-change-note": { type: "string" },
      })
      const title = p.positionals[0]?.trim()
      if (!title || p.positionals.length > 1) throw usageError(this)
      if (ctx.sibling) {
        throw new Error(
          "fix works with the tracker committed with the code: with a tracker of its own, take the steps one by one — naima new, naima open, commit, naima release, naima land",
        )
      }
      const type = str(p, "type") ?? "bugs"
      if (!ctx.registry.types.has(type)) throw new Error(`no type ${type}: name one with --type`)
      const fixedOn = ctx.registry.fields.get("fixedOn")
      if (!fixedOn || !appliesTo(fixedOn, type)) throw new Error(`${type} has no fixedOn, which a fix sets on its branch: name a type that has it with --type`)
      const branch = currentBranch(ctx.root)
      if (branch === "HEAD") throw new Error("HEAD is detached: fix runs on the trunk of the main checkout, or on a worker's branch")
      const changed = hasChange(ctx)
      const nothing = "nothing to fix: this checkout holds no change outside the tracker data — make the change, then run naima fix"
      const commitMessage = str(p, "message")?.trim() || title
      const asked = str(p, "asked-by")
      const coordinator = branch === trunk(ctx.root)
      if (!coordinator) {
        if (!changed) throw new Error(nothing)
        return await asWorker(ctx, branch, type, title, commitMessage, asked)
      }
      const who = str(p, "as") ?? policy.who ?? (filerRole(ctx.root) === "coordinator" ? "coordinator" : undefined)
      if (!who) {
        throw new Error(
          "fix cannot tell who runs it, which names the branch <who>/<what>: give --as <who>, or set the coordination plugin's who option — nothing was written",
        )
      }
      if (!SEGMENT.test(who)) throw new Error(`--as ${who}: each part of a branch name is a ${SEGMENT_SAYS} — nothing was written`)
      // With no change here, a run can still take up the branch an earlier run left, to land what it holds.
      const earlier = filedBefore(ctx, type, title)
      if (!changed && !(earlier && leftover(ctx, `${who}/${earlier.slug}`))) throw new Error(nothing)
      const dirty = gitOrNull(ctx.root, "status", "--porcelain", "--untracked-files=no", "--", ctx.trackerDir) ?? ""
      if (dirty.trim()) throw new Error(`the tracker data has changes not committed, which a landing refuses: commit them first, then run naima fix`)
      return await asCoordinator(ctx, branch, who, type, title, commitMessage, asked, str(p, "no-change-note"))
    },
  }

  async function asWorker(ctx: Context, branch: string, type: string, title: string, commitMessage: string, asked?: string): Promise<number> {
    const item = await file(ctx, type, title, asked)
    const ref = label(item)
    await run(ctx, "claim", ref)
    try {
      await run(ctx, "set", ref, `fixedOn=${today(ctx)}`)
    } finally {
      await run(ctx, "release", ref)
    }
    mustGit(ctx.root, "add", "-A")
    mustGit(ctx.root, "commit", "-q", "-m", commitMessage)
    ctx.out(`committed ${ref} on ${branch}: ${gitOrNull(ctx.root, "rev-parse", "--short=12", "HEAD")?.trim() ?? ""}`)
    ctx.out(`handed over: ${branch} is ready for the coordinator to land — naima land ${branch} --closes ${ref}`)
    return 0
  }

  async function asCoordinator(
    ctx: Context,
    main: string,
    who: string,
    type: string,
    title: string,
    commitMessage: string,
    asked: string | undefined,
    noChangeNote: string | undefined,
  ): Promise<number> {
    const item = await file(ctx, type, title, asked)
    const ref = label(item)
    const itemDir = posixRelative(ctx.root, item.dir)
    // Tracker data only: the trunk guard lets the new item onto the trunk, and the branch opened next starts from it.
    if ((gitOrNull(ctx.root, "status", "--porcelain", "--", itemDir) ?? "").trim()) {
      mustGit(ctx.root, "add", "--", itemDir)
      mustGit(ctx.root, "commit", "-q", "-m", `File ${ref}`, "--", itemDir)
    }
    const left = leftover(ctx, `${who}/${item.slug}`)
    const work = left ?? opened(ctx, who, item)
    const { path, branch } = work
    if (left) ctx.out(`taking up ${branch} in ${path}, left by an earlier run of fix that stopped`)
    const claim = held(ctx, work, item)
    let released = false
    const again = `fix what refused it, then run naima fix "${title}" again from the main checkout, which takes up ${branch}`
    // Every stop leaves the work where it is, with the claim held, and says where the change is and what to do next.
    const stop = (e: unknown, where: string): never => {
      if (released) hold(path, claim)
      throw new Error(
        `${message(e)}\nstopped where the normal path stops: ${branch} and its worktree ${path} stay, ${where}, and ${ref} is still claimed there — ${again}`,
      )
    }
    // Where the change stands: in the main checkout, in the stash between the two, or in the worktree.
    let at = "the change is still in the main checkout"
    try {
      if (hasChange(ctx)) {
        mustGit(ctx.root, "stash", "push", "-q", "--include-untracked", "-m", `naima fix ${ref}`, "--", ":/", `:(top,exclude)${ctx.trackerDir}`)
        at = "the change is in the stash (git stash list shows it)"
        mustGit(path, "stash", "pop", "-q")
      }
      at = "the change is in the worktree, not committed"
      const meta = join(path, itemDir, "meta.json")
      writeJson(meta, { ...JSON.parse(readFileSync(meta, "utf8")) as Record<string, unknown>, fixedOn: today(ctx) })
      if (existsSync(join(path, claim.file))) unlinkSync(join(path, claim.file))
      released = true
      ctx.out(`moved the change to ${path}, set ${ref} fixed and released its claim`)
      mustGit(path, "add", "-A")
      if (gitOrNull(path, "diff", "--cached", "--quiet") === null) mustGit(path, "commit", "-q", "-m", commitMessage)
    } catch (e) {
      stop(e, at)
    }
    const land = async (): Promise<unknown> => {
      try {
        await run(ctx, "land", branch, "--closes", item.meta.id, ...(noChangeNote ? ["--no-change-note", noChangeNote] : []))
        return undefined
      } catch (e) {
        return e
      }
    }
    let refusal = await land()
    if (refusal !== undefined && !landed(ctx, branch)) {
      const trunkName = trunk(ctx.root)
      // The trunk moved since the branch was made: the normal path merges it into the branch and lands again, once.
      if (trunkName && !isAncestor(ctx.root, trunkName, branch)) {
        ctx.out(`the landing was refused: ${trunkName} moved since ${branch} was made — merging it into the branch and landing once more`)
        if (gitOrNull(path, "merge", "-q", "--no-edit", trunkName) === null) {
          gitOrNull(path, "merge", "--abort")
          refusal = new Error(`${message(refusal)}\nmerging ${trunkName} into ${branch} met conflicts, so the merge was undone: merge it by hand in ${path}`)
        } else refusal = await land()
      }
      if (refusal !== undefined && !landed(ctx, branch)) {
        const recorded = await record(ctx, path, item, branch, message(refusal))
        stop(refusal, `with the fix committed${recorded}; or land it by hand: naima release ${ref} in ${path}, then naima land ${branch} --closes ${ref}`)
      }
    }
    if (refusal !== undefined) ctx.out(`landed, and the landing then stopped: ${message(refusal)}`)
    try {
      await run(ctx, "prune", "--branch", branch, "--write")
    } catch (e) {
      ctx.out(`landed, and the branch stays: ${message(e)}`)
    }
    ctx.out(`fixed: ${ref} landed on ${main}`)
    return 0
  }

  /** `openWork`, all or nothing: a refusal midway removes the branch and the worktree it made, never ones that were there before. */
  function opened(ctx: Context, who: string, item: Item): Work {
    const branch = `${who}/${item.slug}`
    const hadBranch = gitOrNull(ctx.root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`) !== null
    const trees = new Set(worktreePaths(ctx.root))
    try {
      return openWork(ctx, policy, [item], who, item.slug)
    } catch (e) {
      for (const path of worktreePaths(ctx.root)) if (!trees.has(path)) gitOrNull(ctx.root, "worktree", "remove", "--force", path)
      if (!hadBranch) gitOrNull(ctx.root, "branch", "-D", branch)
      throw e
    }
  }
}

type Work = { path: string; branch: string; claimFile?: string }

/** Whether the checkout at `ctx.root` holds a change outside the tracker data. */
const hasChange = (ctx: Context): boolean => changedPaths(ctx.root).some((f) => !inside(f, ctx.trackerDir))

/** The worktrees git lists for the repository at `root`. */
function worktreePaths(root: string): string[] {
  return worktrees(root).map((w) => w.path)
}

/** The worktree an earlier run of fix left standing on `branch`, to take up; none when there is none. */
function leftover(ctx: Context, branch: string): Work | undefined {
  const w = worktrees(ctx.root).find((t) => !t.self && t.branch === branch)
  return w ? { path: w.path, branch } : undefined
}

/** The claim the run holds, as its file from the worktree's root and its text: the one open made, or the one an earlier run left there. */
type Held = { file: string; text: string }

function held(ctx: Context, work: Work, item: Item): Held {
  if (work.claimFile) return { file: work.claimFile, text: readFileSync(join(work.path, work.claimFile), "utf8") }
  const dir = `${ctx.trackerDir}/claims` // the coordination plugin's claims directory, as open writes it
  for (const name of existsSync(join(work.path, dir)) ? readdirSync(join(work.path, dir)) : []) {
    if (!name.endsWith(".json")) continue
    const text = readFileSync(join(work.path, dir, name), "utf8")
    try {
      if ((JSON.parse(text) as { branch?: unknown }).branch === work.branch) return { file: `${dir}/${name}`, text }
    } catch {
      // not a claim this run can read: someone else's
    }
  }
  const claim = { file: `${dir}/${randomUUID()}.json`, text: "" }
  claim.text =
    JSON.stringify({ branch: work.branch, claimedAt: today(ctx), items: [{ id: item.meta.id, ref: label(item), title: item.meta.title }] }, null, 2) + "\n"
  hold(work.path, claim)
  return claim
}

/** The claim written back in the worktree, not committed: the work left there is claimed, and the branch's tip stays released for a landing. */
function hold(path: string, claim: Held): void {
  mkdirSync(dirname(join(path, claim.file)), { recursive: true })
  writeFileSync(join(path, claim.file), claim.text)
}

/** Whether `branch` is on the trunk. */
function landed(ctx: Context, branch: string): boolean {
  const t = trunk(ctx.root)
  return !!t && isAncestor(ctx.root, branch, t)
}

/**
 * The reason of a refused landing recorded on the item through naima note, in the main checkout, then moved to the
 * worktree and committed on the branch, so the trunk does not move. Returns what to add to the stop's message.
 */
async function record(ctx: Context, path: string, item: Item, branch: string, reason: string): Promise<string> {
  const ref = label(item)
  const itemDir = posixRelative(ctx.root, item.dir)
  try {
    await run(ctx, "note", ref, `naima fix stopped: the landing of ${branch} was refused. ${reason.replace(/^#+\s*/gm, "")}`)
    mustGit(ctx.root, "stash", "push", "-q", "-m", `naima fix note ${ref}`, "--", itemDir)
    mustGit(path, "stash", "pop", "-q")
    mustGit(path, "add", "--", itemDir)
    mustGit(path, "commit", "-q", "-m", `Record why the landing of ${branch} was refused`, "--", itemDir)
    return `, and the reason recorded on ${ref}, committed on the branch`
  } catch (e) {
    return `; the reason could not be recorded on ${ref} (${message(e)})`
  }
}
