// Change notes at the landing. A repository of the project — the project
// itself, or a product it holds as a submodule — that has changes/config.json
// names its behaviour paths there; a branch that changes one of them adds a
// change note in that repository's changes/ (core/changes.ts reads them).
// `naima land` refuses a branch that does not, unless --no-change-note gives
// the reason, which the marker records; the check change-notes says the same
// on the branch, and `naima changes` assembles the release notes.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  behaviourOf,
  type ChangeNote,
  CHANGES,
  CHANGES_CONFIG,
  type Check,
  type Command,
  commitExists,
  type Context,
  creditsMarkdown,
  creditsOf,
  currentBranch,
  type Finding,
  gitOrNull,
  isNotePath,
  notesBetween,
  parse,
  parseChangeNote,
  releaseNotes,
  str,
  trunk,
  unnoted,
  usageError,
} from "../../core/api.ts"

/** The trailer a marker gives the reason a behaviour change carries no change note with. */
export const NO_CHANGE_NOTE = "No-change-note"

/** The tree of an empty repository: what a range with no start is compared from. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

/** The submodules `root` records at `rev`, by path: the commit each pointer names. */
export function gitlinks(root: string, rev: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const entry of (gitOrNull(root, "ls-tree", "-r", "-z", rev) ?? "").split("\0")) {
    const tab = entry.indexOf("\t")
    const [mode, type, sha] = entry.slice(0, tab).split(" ")
    if (mode === "160000" && type === "commit" && sha) out.set(entry.slice(tab + 1), sha)
  }
  return out
}

/** A repository of the project whose change notes are read: where it is on disk, and how its paths are said. */
interface Product {
  dir: string
  /** Its path in the project, with a slash, or "" for the project itself. */
  prefix: string
}

/** A submodule checked out at `path`: its own .git, a file or a directory. */
const checkedOut = (root: string, path: string): boolean => existsSync(join(root, path, ".git"))

/** What `branch` changes in each repository with change notes from `old` to `tip`, with no note: paths as the project names them. */
function unnotedBetween(ctx: Context, old: string, tip: string): { paths: string[]; dirs: string[]; unreadable: string[] } {
  const paths: string[] = []
  const dirs: string[] = []
  const unreadable: string[] = []
  const take = (p: Product, from: string, to: string) => {
    const missing = unnoted(p.dir, from, to)
    if (missing.length) {
      paths.push(...missing.map((m) => p.prefix + m))
      dirs.push(`${p.prefix}${CHANGES}/`)
    }
    if (behaviourOf(p.dir, to)) unreadable.push(...notesBetween(p.dir, from, to).unreadable.map((u) => p.prefix + u))
  }
  take({ dir: ctx.root, prefix: "" }, old, tip)
  const before = gitlinks(ctx.root, old)
  for (const [path, sha] of gitlinks(ctx.root, tip)) {
    const was = before.get(path)
    if (!was || was === sha || !checkedOut(ctx.root, path)) continue
    const dir = join(ctx.root, path)
    if (!commitExists(dir, sha)) {
      if (commitExists(dir, was) && behaviourOf(dir, was)) {
        throw new Error(
          `${path}/ lacks ${sha.slice(0, 12)}, the commit the branch records, so its change notes cannot be read: git -C ${path} fetch, then land again`,
        )
      }
      continue
    }
    if (commitExists(dir, was)) take({ dir, prefix: `${path}/` }, was, sha)
  }
  return { paths, dirs, unreadable }
}

const listed = (paths: readonly string[]): string => paths.slice(0, 8).join(", ") + (paths.length > 8 ? `, and ${paths.length - 8} more` : "")

/**
 * Refuse to land `branch` when it changes behaviour with no change note, or adds a note that does not parse;
 * with `reason` (--no-change-note), the trailer the marker carries instead.
 */
export function changeNoteTrailers(ctx: Context, branch: string, old: string, tip: string, reason: string | undefined): string[] {
  if (reason !== undefined && (!reason.trim() || reason.includes("\n"))) throw new Error(`--no-change-note takes the reason, on one line`)
  const { paths, dirs, unreadable } = unnotedBetween(ctx, old, tip)
  if (unreadable.length) throw new Error(`${branch} adds a change note that is not one: ${unreadable.join("; ")}`)
  if (!paths.length) return []
  if (reason !== undefined) return [`${NO_CHANGE_NOTE}: ${reason.trim()}`]
  throw new Error(
    `${branch} changes behaviour with no change note: ${listed(paths)} — add one under ${
      [...new Set(dirs)].join(" and ")
    } (${CHANGES}/README.md says how), or land with --no-change-note "<reason>" when nothing a person or an agent sees changes`,
  )
}

/** The repositories of the project with change notes on disk: the project itself, and each submodule checked out. */
function productsOnDisk(ctx: Context): Product[] {
  const out: Product[] = []
  if (existsSync(join(ctx.root, CHANGES_CONFIG))) out.push({ dir: ctx.root, prefix: "" })
  for (const path of gitlinks(ctx.root, "HEAD").keys()) {
    if (checkedOut(ctx.root, path) && existsSync(join(ctx.root, path, CHANGES_CONFIG))) out.push({ dir: join(ctx.root, path), prefix: `${path}/` })
  }
  return out
}

/** Every file of a product's changes/ on disk that is not a change note, with why. */
function malformed(p: Product): Finding[] {
  const out: Finding[] = []
  for (const name of readdirSync(join(p.dir, CHANGES)).filter((f) => f.endsWith(".md") && f !== "README.md").sort()) {
    const path = `${CHANGES}/${name}`
    const subject = p.prefix + path
    if (!isNotePath(path)) {
      out.push({ level: "problem", subject, message: `${subject} is not named as a change note is: ${CHANGES}/<YYYY-MM-DD>-<slug>.md` })
      continue
    }
    try {
      parseChangeNote(path, readFileSync(join(p.dir, path), "utf8"))
    } catch (e) {
      out.push({ level: "problem", subject, message: `${subject} is not a change note: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  return out
}

export const changeNotesCheck: Check = {
  name: "change-notes",
  says:
    `every file of a ${CHANGES}/ directory that has a ${CHANGES_CONFIG} — the project's own, or a submodule's — is a change note that parses; on a branch other than the trunk, one whose commits change a behaviour path that file names with no change note added is a note, as naima land would refuse it`,
  run(ctx) {
    const products = productsOnDisk(ctx)
    const out = products.flatMap(malformed)
    const main = trunk(ctx.root)
    const branch = currentBranch(ctx.root)
    if (!main || branch === "HEAD" || branch === main) return out
    const base = gitOrNull(ctx.root, "merge-base", main, "HEAD")
    if (!base) return out
    const paths: string[] = []
    const dirs: string[] = []
    const before = gitlinks(ctx.root, base)
    for (const p of products) {
      const from = p.prefix ? before.get(p.prefix.slice(0, -1)) : base
      const to = p.prefix ? gitOrNull(p.dir, "rev-parse", "HEAD") : "HEAD"
      if (!from || !to || !commitExists(p.dir, from)) continue
      const missing = unnoted(p.dir, from, to)
      if (!missing.length) continue
      paths.push(...missing.map((m) => p.prefix + m))
      dirs.push(`${p.prefix}${CHANGES}/`)
    }
    if (paths.length) {
      out.push({
        level: "note",
        subject: branch,
        message: `${branch} changes behaviour with no change note: ${listed(paths)} — add one under ${
          dirs.join(" and ")
        } (${CHANGES}/README.md says how); if nothing a person or an agent sees changes, the landing says why: naima land --no-change-note "<reason>"`,
      })
    }
    return out
  },
}

/** The newest version tag at or before `rev` in `dir`, or null. */
const lastTag = (dir: string, rev: string): string | null => gitOrNull(dir, "describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", rev)

export const changesCommand: Command = {
  name: "changes",
  says:
    `print the release notes a range of commits makes, assembled from the change notes it adds to ${CHANGES}/, as Markdown: breaking changes first, then those that need an action, then features, behaviour changes and fixes, each with its text and what to do, and a Credits section last, as naima credits --markdown prints it; from the newest version tag (v…) to HEAD unless --from and --to say otherwise, in every repository of the project with a ${CHANGES_CONFIG} (the project itself, a submodule) unless --repo names one`,
  enforces: "nothing: it only prints; a change note that does not parse is named on stderr",
  usage: "changes [--from <commit>] [--to <commit>] [--repo <path>]",
  options: [
    { name: "--from", says: "where the range starts, a commit or tag", default: "the newest version tag before --to, else the first commit" },
    { name: "--to", says: "where the range ends", default: "HEAD" },
    { name: "--repo", says: `the repository to read, relative to the project's root: one with a ${CHANGES_CONFIG}` },
  ],
  examples: ["changes", "changes --from v1.0.0", "changes --repo naima --from v1.0.0 --to main"],
  run(args, ctx) {
    const p = parse(args, { from: { type: "string" }, to: { type: "string" }, repo: { type: "string" } })
    if (p.positionals.length) throw usageError(this)
    const repo = str(p, "repo")
    const products = repo !== undefined ? [{ dir: join(ctx.root, repo), prefix: repo ? `${repo}/` : "" }] : productsOnDisk(ctx)
    if (!products.length) {
      throw new Error(
        `no repository of this project has a ${CHANGES_CONFIG}, so it keeps no change notes: the release notes come from naima announce --gate <gate>, or start keeping change notes with a ${CHANGES_CONFIG} (naima guide lists the page)`,
      )
    }
    for (const product of products) {
      const to = str(p, "to") ?? "HEAD"
      if (!commitExists(product.dir, to)) throw new Error(`no commit ${to} in ${product.prefix || "the project"}`)
      const from = str(p, "from") ?? lastTag(product.dir, to)
      if (from !== null && !commitExists(product.dir, from)) throw new Error(`no commit ${from} in ${product.prefix || "the project"}`)
      const { notes, unreadable } = notesBetween(product.dir, from ?? EMPTY_TREE, to)
      for (const u of unreadable) ctx.err(`naima: ${product.prefix}${u}`)
      const where = products.length > 1 || product.prefix ? ` in ${product.prefix.slice(0, -1) || "the project"}` : ""
      ctx.out(`# Changes${where}${from ? ` since ${from}` : ""}`)
      ctx.out()
      const lines: string[] = notes.length ? releaseNotes(notes as ChangeNote[]) : ["No change notes in this range.", ""]
      for (const line of lines) ctx.out(line)
    }
    for (const line of creditsMarkdown(creditsOf(ctx))) ctx.out(line)
    return 0
  },
}
