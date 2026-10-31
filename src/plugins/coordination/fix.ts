// naima fix: one command takes a small fix from filing to landing. Run by the
// coordinator on the main checkout, on the trunk, it files the item, opens its
// worktree, commits the change there and lands it; run by a worker on its
// branch, it files, commits and hands the branch over. It makes its own claim
// and releases it on every path that made it. The protocol is the model
// develop/models/small-fix/fix.mcrl2, verified before this code.

import { readFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import {
  appliesTo,
  type Command,
  type Context,
  currentBranch,
  gitOrNull,
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
  writeJson,
} from "../../core/api.ts"
import type { Policy } from "./worktrees.ts"

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

/** File the item through `naima new`, every write hook included, and return it. */
async function file(ctx: Context, type: string, title: string, asked: string | undefined): Promise<Item> {
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
      "take a small fix from filing to landing in one step: on the main checkout, on the trunk, file the item, open its worktree, move the change there, commit it and land it; on a worker's branch, file the item, commit the change on the branch and hand it over to the coordinator",
    enforces:
      "the change is what the checkout holds uncommitted outside the tracker data, and there must be one; the item's type has fixedOn, which is set on the branch; the command makes its own claim and releases it on every path that made it, before it stops and before a landing; a worker's run never touches the trunk; the coordinator's commits on the trunk are the new item (tracker data only) and the landing marker; a refusal stops it where it is and says what is left: a landing refused leaves the branch committed and handed over",
    usage: 'fix "<title>" [--type <type>] [--message "<commit message>"] [--as <who>] [--asked-by <role>] [--no-change-note "<reason>"]',
    options: [
      { name: "--type", says: "the item's type: one with fixedOn", default: "bugs" },
      { name: "--message", says: "the commit message of the change", default: "the item's title" },
      { name: "--as", says: "who works, for the coordinator's branch: its first segment", ...(policy.who ? { default: policy.who } : {}) },
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
      if (!changedPaths(ctx.root).some((f) => !inside(f, ctx.trackerDir))) {
        throw new Error("nothing to fix: this checkout holds no change outside the tracker data — make the change, then run naima fix")
      }
      const commitMessage = str(p, "message")?.trim() || title
      const asked = str(p, "asked-by")
      const coordinator = branch === trunk(ctx.root)
      if (!coordinator) return await asWorker(ctx, branch, type, title, commitMessage, asked)
      const who = str(p, "as") ?? policy.who
      if (!who) throw new Error("fix needs --as <who>, the branch's first segment, or the coordination plugin's who option")
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
    mustGit(ctx.root, "add", "--", itemDir)
    mustGit(ctx.root, "commit", "-q", "-m", `File ${ref}`, "--", itemDir)
    const { path, branch, claimFile } = openWork(ctx, policy, [item], who, item.slug)
    const release = (): void => unlinkSync(join(path, claimFile))
    try {
      mustGit(ctx.root, "stash", "push", "-q", "--include-untracked", "-m", `naima fix ${ref}`, "--", ":/", `:(top,exclude)${ctx.trackerDir}`)
      mustGit(path, "stash", "pop", "-q")
    } catch (e) {
      release()
      throw new Error(`${message(e)}\nthe change could not move to ${path}: git stash list shows it if it is not there; ${branch}'s claim is released`)
    }
    const meta = join(path, itemDir, "meta.json")
    writeJson(meta, { ...JSON.parse(readFileSync(meta, "utf8")) as Record<string, unknown>, fixedOn: today(ctx) })
    release()
    ctx.out(`moved the change to ${path}, set ${ref} fixed and released its claim`)
    mustGit(path, "add", "-A")
    mustGit(path, "commit", "-q", "-m", commitMessage)
    try {
      await run(ctx, "land", branch, "--closes", item.meta.id, ...(noChangeNote ? ["--no-change-note", noChangeNote] : []))
    } catch (e) {
      throw new Error(
        `${
          message(e)
        }\nhanded over: ${branch} is committed in ${path}, its claim released — fix what the landing refused, then naima land ${branch} --closes ${ref}`,
      )
    }
    try {
      await run(ctx, "prune", "--branch", branch, "--write")
    } catch (e) {
      ctx.out(`landed, and the branch stays: ${message(e)}`)
    }
    ctx.out(`fixed: ${ref} landed on ${main}`)
    return 0
  }
}
