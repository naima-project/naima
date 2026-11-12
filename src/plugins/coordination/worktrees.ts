// Where work happens, by one scheme: the worktree folder
// `<worktrees>/<what>` stands on the branch `<who>/<what>`, and carries a
// claim. What reads the scheme and checks it lives here; the commands that
// write claims are in ./index.ts.

import { existsSync, realpathSync } from "node:fs"
import { basename, dirname, resolve, win32 } from "node:path"
import { type CheckOptions, type Finding, gitOrNull, gitReason, isGitRepo, mustGit, runGit, trunk, type Worktree, worktrees } from "../../core/api.ts"

/** The plugin's options that shape the scheme. */
export interface Policy {
  /** Who works, when `open` is given no `--as`. */
  who?: string
  /** The worktrees directory, relative to the main worktree. */
  worktrees?: string
  /** Branches the scheme does not apply to: names, or patterns with `*`. */
  exempt: string[]
  /** How many worker worktrees may be open at once before `open` refuses another: the option `maxWorkers`. */
  maxWorkers: number
}

/** The default bound on worker worktrees open at once. */
export const MAX_WORKERS = 3

export function readPolicy(options: Record<string, unknown>): Policy {
  const { who, worktrees: dir, exempt = [], maxWorkers = MAX_WORKERS } = options
  if (who !== undefined && (typeof who !== "string" || !SEGMENT.test(who))) throw new Error(`coordination: option who must be a ${SEGMENT_SAYS}`)
  if (dir !== undefined && (typeof dir !== "string" || !dir)) throw new Error("coordination: option worktrees must be a path")
  if (!Array.isArray(exempt) || !exempt.every((e) => typeof e === "string")) throw new Error("coordination: option exempt must be a list of branch names")
  if (typeof maxWorkers !== "number" || !Number.isInteger(maxWorkers) || maxWorkers < 1) {
    throw new Error(
      `coordination: option maxWorkers must be a positive whole number, how many worker worktrees may be open at once; got ${JSON.stringify(maxWorkers)}`,
    )
  }
  return { ...(who ? { who } : {}), ...(dir ? { worktrees: dir } : {}), exempt, maxWorkers }
}

/** One segment of a branch name: what `<who>` and `<what>` each are. */
export const SEGMENT = /^[a-z0-9][a-z0-9.-]*$/
export const SEGMENT_SAYS = "lowercase name: letters a-z, digits, dots and dashes, starting with a letter or a digit"
const BRANCH = /^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9.-]*$/

const realOr = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

const glob = (pattern: string): RegExp => new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\/]/g, "\\$&")).join("[^]*")}$`)

export const isExempt = (policy: Policy, branch: string): boolean => policy.exempt.some((e) => glob(e).test(branch))

/** The main worktree: the first git lists. */
export function home(root: string, trees: Worktree[] = worktrees(root)): string {
  return trees[0]?.path ?? root
}

/** The directory every worktree is a folder of: `<main>-worktrees` beside the main worktree, unless configured. */
export function worktreesDir(policy: Policy, main: string): string {
  return resolve(main, policy.worktrees ?? `../${basename(main)}-worktrees`)
}

/**
 * One directory, whether or not either path can be resolved here: the program may not read outside its project.
 * On Windows paths are compared as the file system does: either slash, any letter case, drive letter included.
 */
export function samePath(a: string, b: string, platform: string = process.platform): boolean {
  if (a === b || realOr(a) === realOr(b)) return true
  if (platform !== "win32") return false
  const folded = (p: string): string => win32.resolve(realOr(p)).replace(/[\\/]+$/, "").toLowerCase()
  return folded(a) === folded(b)
}
const same = (a: string, b: string): boolean => samePath(a, b)

/** Whether a landing marker, on the trunk or on a line, has the branch's present tip as its second parent: the branch is landed and done. */
export function landedTip(root: string, branch: string): boolean {
  const tip = gitOrNull(root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`)
  if (!tip) return false
  const log = gitOrNull(root, "log", "--all", "--merges", "-F", `--grep=Land ${branch}`, "--format=%P%x09%s") ?? ""
  return log.split("\n").some((l) => {
    const [parents = "", subject = ""] = l.split("\t")
    return subject === `Land ${branch}` && parents.split(" ")[1] === tip
  })
}

/**
 * The worker worktrees open now: every worktree but the main one that is a folder of the worktrees directory, on a branch the scheme applies to,
 * and not landed: a worktree whose branch tip a landing marker holds is finished work waiting to be pruned, and holds no slot.
 */
export function workerTrees(root: string, policy: Policy, trees: Worktree[] = worktrees(root)): Worktree[] {
  const dir = worktreesDir(policy, home(root, trees))
  return trees.slice(1).filter((w) => !!w.branch && !isExempt(policy, w.branch) && same(dirname(w.path), dir) && !landedTip(root, w.branch))
}

/**
 * Why `open` may not add a worker worktree: as many as the option
 * `maxWorkers` are open already. The refusal names each, and says how to free
 * one or raise the bound; null while there is room.
 */
export function workerBoundReason(
  root: string,
  policy: Policy,
  trees: Worktree[] = worktrees(root),
  line?: { name: string; holds(branch: string): boolean },
): string | null {
  // The bound counts per line: the trunk is one line, each development line another.
  const open = workerTrees(root, policy, trees).filter((w) => !line || line.holds(w.branch ?? ""))
  if (open.length < policy.maxWorkers) return null
  return [
    `${plural(open.length, "worker worktree")} ${open.length === 1 ? "is" : "are"} open${
      line ? ` ${line.name}` : ""
    }, the coordination option maxWorkers (${policy.maxWorkers}): open no more until one is done`,
    ...open.map((w) => `  ${w.branch}  ${w.path}`),
    "finish and land one, or give two small items to one worker (naima open <item> <item>);",
    `raise the bound only on purpose, in naima.json: "plugins": { "coordination": { "options": { "maxWorkers": ${policy.maxWorkers + 1} } } }`,
  ].join("\n")
}

/** Whether a path exists, false when this run may not look: what git is then asked to refuse. */
export const exists = (path: string): boolean => {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

/**
 * Put a file in another worktree, untracked, through git: the program may
 * write only its own worktree's tracker, while git runs unfenced. The file
 * goes through that worktree's index and out of it again, so nothing is left
 * staged.
 */
export function writeThroughGit(worktree: string, file: string, text: string): void {
  const blob = runGit(worktree, ["hash-object", "-w", "--stdin"], { input: text })
  if (!blob.ok) throw new Error(`git hash-object: ${gitReason(blob)}`)
  mustGit(worktree, "update-index", "--add", "--cacheinfo", `100644,${blob.out.trim()},${file}`)
  try {
    mustGit(worktree, "checkout-index", "--", file)
  } finally {
    mustGit(worktree, "update-index", "--force-remove", "--", file)
  }
}

/**
 * Before a worktree is removed: copy every commit its submodules hold that exists nowhere else — not in the main
 * checkout's clone of the same submodule, not on any remote-tracking branch — into the main checkout's clone, under the
 * branch's own name when the main clone has no branch of that name, else under `kept/<worktree>/<name>`. Removing a
 * worktree deletes its submodules' git folders, and a pointer landed from it would otherwise name a commit that no longer
 * exists. Throws, copying nothing more, when the main checkout has no clone of that submodule to copy into. Returns one
 * line per copied ref.
 */
export function keepSubmoduleCommits(repo: string, tree: string, trees: Worktree[] = worktrees(repo)): string[] {
  const main = trees[0]?.path
  if (!main || samePath(main, tree)) return []
  const out: string[] = []
  const paths = (gitOrNull(tree, "ls-files", "--stage") ?? "").split("\n").filter((l) => l.startsWith("160000 ")).map((l) => l.split("\t")[1]!)
  for (const path of paths) {
    const sub = resolve(tree, path)
    if (!exists(resolve(sub, ".git"))) continue
    const refs = (gitOrNull(sub, "for-each-ref", "--format=%(objectname) %(refname)", "refs/heads") ?? "").split("\n").filter(Boolean)
      .map((l) => l.split(" ") as [string, string])
    const head = gitOrNull(sub, "rev-parse", "--verify", "--quiet", "HEAD^{commit}")
    if (head && !refs.some(([sha]) => sha === head)) refs.push([head, "HEAD"])
    const into = resolve(main, path)
    const target = exists(resolve(into, ".git")) ? into : null
    for (const [sha, ref] of refs) {
      if (target && gitOrNull(target, "cat-file", "-e", `${sha}^{commit}`) !== null) continue
      if ((gitOrNull(sub, "branch", "-r", "--contains", sha) ?? "").trim() !== "") continue
      if (!target) {
        throw new Error(
          `the submodule ${path} in ${tree} holds ${sha.slice(0, 12)} (${
            ref.replace(/^refs\/heads\//, "")
          }), which no remote and no clone in the main checkout has: removing the worktree would lose it — push it, or run git submodule update --init ${path} in ${main}, first`,
        )
      }
      const name = ref === "HEAD" ? "HEAD" : ref.replace(/^refs\/heads\//, "")
      const own = name !== "HEAD" && gitOrNull(target, "rev-parse", "--verify", "--quiet", `refs/heads/${name}`) === null
      const dest = own ? name : `kept/${basename(tree)}/${name}`
      const r = runGit(target, ["fetch", "-q", "--no-tags", sub, `+${ref}:refs/heads/${dest}`])
      if (!r.ok) throw new Error(`copying ${path}'s ${name} from ${tree} into ${into} failed, so the worktree stays: ${gitReason(r)}`)
      out.push(`kept ${path}'s ${name} (${sha.slice(0, 12)}) in ${into} as ${dest}: the worktree held its only copy`)
    }
  }
  return out
}

export const plural = (n: number, what: string): string => `${n} ${what}${n === 1 ? "" : "s"}`

/** How many commits `ref` has that `base` has not. */
export const ahead = (root: string, base: string, ref: string): number => Number(gitOrNull(root, "rev-list", "--count", `${base}..${ref}`) ?? 0)

/** How many commits `ref` has that `base` has not, and how many `base` has that `ref` has not: one git call, not two. */
export function aheadBehind(root: string, base: string, ref: string): { ahead: number; behind: number } {
  const [behind = 0, ahead = 0] = (gitOrNull(root, "rev-list", "--left-right", "--count", `${base}...${ref}`) ?? "").split(/\s+/).map(Number)
  return { ahead: ahead || 0, behind: behind || 0 }
}

/**
 * Who holds a worktree's branch: a claim with items; or, once released at
 * closing, a claim file its unmerged commits added, or a session note
 * written on it.
 */
export interface Holders {
  claimed: Set<string>
  noted: Set<string>
  /** The claims directory, as git names it in `repo`: where a released claim's history is looked for. */
  claims: string
  /** The repository the claims are committed in: the project's, or the tracker's own in sibling mode, on the branch of the same name. */
  repo?: string
}

/**
 * The scheme, checked: every worktree but the main one is a folder of the
 * worktrees directory named for its branch's last segment; every local
 * branch but the trunk is `<who>/<what>`; and every worktree carries a claim.
 * One with commits the trunk has not and nothing holding it (no claim now,
 * none added by those commits, no session note) is a problem;
 * one with nothing on it yet is a note. A worktree outside the worktrees
 * directory that nothing holds is not Naima's (made before Naima was
 * installed, or by plain git): one note says where Naima puts its own, and
 * nothing more is asked of it.
 *
 * A gate judges its own tree: a sibling worktree's missing claim is a note
 * naming it, never a problem, so one worker's missing claim cannot fail
 * every other branch's gate. It is still a problem for the worktree being
 * checked itself (`w.self`), and, with `options.allWorktrees`, for every
 * worktree — the coordinator's view (`naima check --all-worktrees`).
 */
export function policyFindings(
  root: string,
  policy: Policy,
  holders: Holders,
  options: CheckOptions = {},
  baseOf: (branch: string) => string | null = () => trunk(root),
): Finding[] {
  if (!isGitRepo(root)) return []
  const out: Finding[] = []
  const main = trunk(root)
  const trees = worktrees(root)
  const dir = worktreesDir(policy, home(root, trees))
  const claimsRepo = holders.repo ?? root
  const claimsMain = claimsRepo === root ? main : trunk(claimsRepo)
  for (const w of trees.slice(1)) {
    if (!w.branch || isExempt(policy, w.branch)) continue
    const last = w.branch.split("/").pop() ?? w.branch
    // A branch of a development line is measured against its line, not the trunk.
    const base = baseOf(w.branch) ?? main
    const n = base ? ahead(root, base, w.branch) : 0
    const from = claimsRepo === root ? base : claimsMain
    // A sync of a line (sync/<gate>) belongs to the line it merges the trunk into: it holds no claim.
    const held = w.branch.startsWith("sync/") || holders.claimed.has(w.branch) || holders.noted.has(w.branch) ||
      !!(n && gitOrNull(claimsRepo, "log", "-1", "--format=%H", "--diff-filter=A", `${from}..${w.branch}`, "--", holders.claims || "."))
    if (!same(dirname(w.path), dir)) {
      if (!held) {
        out.push({
          level: "note",
          message: `worktree ${w.path} is outside ${dir}, where Naima puts the worktrees it makes (naima open): it carries no claim, so Naima leaves it alone`,
        })
        continue
      }
      out.push({ level: "problem", message: `worktree ${w.path} is outside ${dir}: a worktree is ${dir}/<what>, on <who>/<what> (naima open)` })
    } else if (basename(w.path) !== last) {
      out.push({ level: "problem", message: `worktree ${w.path} is on ${w.branch}: its folder must be named ${last}, the branch's last segment` })
    }
    if (held) continue
    const level = w.self || options.allWorktrees ? (n ? "problem" : "note") : "note"
    out.push(
      n
        ? {
          level,
          message: `worktree ${w.path} (${w.branch}) carries no claim and has ${
            plural(n, "commit")
          } not on ${base}: claim its items there (naima claim), or, once they are released, write its session note (naima pass)`,
        }
        : { level, message: `worktree ${w.path} (${w.branch}) carries no claim: claim its items there before any work (naima claim)` },
    )
  }
  for (const line of (gitOrNull(root, "for-each-ref", "--format=%(refname:short)", "refs/heads") ?? "").split("\n")) {
    const b = line.trim()
    if (!b || b === main || isExempt(policy, b) || BRANCH.test(b)) continue
    out.push({
      level: "problem",
      message:
        `branch ${b} is off the naming scheme <who>/<what>, each a ${SEGMENT_SAYS}: rename it (git branch -m), or list it under the coordination plugin's exempt option`,
    })
  }
  return out
}

/** Reflog subjects of a commit made on the branch itself, rather than brought by a merge or a fast-forward. */
const DIRECT = /^(commit|commit \(amend\)|cherry-pick|revert):/

/**
 * What a branch being prepared is told about the trunk: that it has moved
 * since the branch last took it, and which of those commits the trunk's
 * reflog records as committed on it directly — outside the flow, where
 * every change arrives by a merge.
 */
export function preparingFindings(root: string, branch: string, base: string | null = trunk(root)): Finding[] {
  const main = base
  if (!main || branch === main) return []
  // A branch the trunk already holds is merged, not being prepared: its claim rode along.
  if (gitOrNull(root, "merge-base", "--is-ancestor", branch, main) !== null) return []
  const n = ahead(root, branch, main)
  if (!n) return []
  const out: Finding[] = [{
    level: "note",
    message: `${main} took ${
      plural(n, "commit")
    } ${branch} does not have, while it is being prepared: merge ${main} into it again (git merge --no-edit ${main})`,
  }]
  const missing = new Set((gitOrNull(root, "rev-list", `${branch}..${main}`) ?? "").split("\n").filter(Boolean))
  const seen = new Set<string>()
  for (const line of (gitOrNull(root, "log", "-g", "--format=%H%x09%h%x09%gs%x09%s", `refs/heads/${main}`) ?? "").split("\n")) {
    const [sha = "", short = "", how = "", subject = ""] = line.split("\t")
    if (!missing.has(sha) || seen.has(sha) || !DIRECT.test(how)) continue
    seen.add(sha)
    out.push({ level: "note", message: `${short} "${subject}" was committed on ${main} directly, outside the flow, while ${branch} was open` })
  }
  return out
}
