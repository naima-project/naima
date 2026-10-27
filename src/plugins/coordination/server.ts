// The trunk guarded on the server too: `naima guard server`. The git hook
// guards a clone that has it; a clone without it (a fresh one, another
// machine, a tool that skips hooks) can still push the trunk. When the code's
// origin is on GitHub, a branch ruleset closes that: only those who may bypass
// it, the repository's admins, which is who the coordinator pushes as, update
// the trunk. Naima says it exists and never makes it by itself: the command is
// the owner's word. With the GitHub CLI `gh` it makes the ruleset; without it,
// or with --print, it says the exact request and the web page instead.

import { spawnSync } from "node:child_process"
import { type Context, githubRepo, gitOrNull } from "../../core/api.ts"

/** The ruleset's name on GitHub: what tells Naima's from any other, so it is made once. */
export const RULESET_NAME = "naima: only the coordinator pushes the trunk"
/** GitHub's id of the repository admin role, the one actor that may bypass the ruleset. */
export const ADMIN_ROLE = 5

/** `owner/repo` of the code's origin when it is on GitHub, else null. */
export const githubOrigin = (root: string): string | null => {
  const url = gitOrNull(root, "remote", "get-url", "origin")
  return url ? githubRepo(url) : null
}

/** The ruleset: updates, deletions and force-pushes of the trunk refused to all but the repository's admins. */
export const rulesetOf = (main: string) => ({
  name: RULESET_NAME,
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: [`refs/heads/${main}`], exclude: [] } },
  rules: [{ type: "update" }, { type: "deletion" }, { type: "non_fast_forward" }],
  bypass_actors: [{ actor_id: ADMIN_ROLE, actor_type: "RepositoryRole", bypass_mode: "always" }],
})

/** What the owner is told, as information, when the code's origin is on GitHub: that the server can guard the trunk, and how. */
export const serverHint = (repo: string, main: string): string =>
  `The server can guard ${main} too, for a clone without this hook: naima guard server makes a GitHub ruleset on ${repo} that lets only ` +
  `the repository's admins, who the coordinator pushes as, update ${main}. Naima never makes it by itself: tell the owner, as information, ` +
  `and run it only on their word`

/** The hint for this project, or null when its origin is not on GitHub. */
export const serverHintOf = (root: string, main: string): string | null => {
  const repo = githubOrigin(root)
  return repo ? serverHint(repo, main) : null
}

interface Gh {
  ok: boolean
  missing: boolean
  out: string
  err: string
}

/** Run the GitHub CLI; `missing` when it cannot be started at all. */
function gh(args: string[], input?: string): Gh {
  try {
    const r = spawnSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], timeout: 30_000 })
    if (r.error) return { ok: false, missing: true, out: "", err: r.error.message }
    return { ok: r.status === 0, missing: false, out: String(r.stdout ?? ""), err: String(r.stderr ?? "").trim() }
  } catch (e) {
    return { ok: false, missing: true, out: "", err: e instanceof Error ? e.message : String(e) }
  }
}

/** The request said for the owner to make: with gh, with curl, and the web page. */
function printed(ctx: Context, repo: string, body: string, why: string): void {
  ctx.out(`${why}. The ruleset, as GitHub's API takes it — save it as ruleset.json:`)
  for (const line of body.split("\n")) ctx.out(`  ${line}`)
  ctx.out(`with the GitHub CLI: gh api --method POST repos/${repo}/rulesets --input ruleset.json`)
  ctx.out(
    `with curl and a token that may administer the repository: curl -X POST -H "Authorization: Bearer <token>" -H "Accept: application/vnd.github+json" ` +
      `https://api.github.com/repos/${repo}/rulesets -d @ruleset.json`,
  )
  ctx.out(
    `or by hand, on the web: https://github.com/${repo}/settings/rules/new?target=branch — target the trunk, restrict updates, deletions and force pushes, and let Repository admin bypass`,
  )
}

/** `naima guard server [--print]`: make the ruleset with gh, or say the request; 0 when made, already there or said, 1 otherwise. */
export function guardServer(ctx: Context, main: string, print: boolean): number {
  const repo = githubOrigin(ctx.root)
  if (!repo) {
    ctx.out(`the code's origin is not on GitHub: naima guard server makes GitHub's rulesets only — protect ${main} with the host's own branch protection`)
    return 1
  }
  const body = JSON.stringify(rulesetOf(main), null, 2)
  if (print) {
    printed(ctx, repo, body, `nothing sent to GitHub (--print)`)
    return 0
  }
  const list = gh(["api", `repos/${repo}/rulesets`])
  if (list.missing) {
    printed(ctx, repo, body, `the GitHub CLI, gh, is not on PATH: nothing sent to GitHub`)
    return 0
  }
  if (!list.ok) {
    printed(ctx, repo, body, `gh could not read the rulesets of ${repo} (${list.err.split("\n")[0] || "gh failed"}): nothing sent to GitHub`)
    return 1
  }
  try {
    const found = (JSON.parse(list.out) as { id?: number; name?: string }[]).find((r) => r.name === RULESET_NAME)
    if (found) {
      ctx.out(`${repo} has the ruleset already (${found.id}): only the repository's admins update ${main} — https://github.com/${repo}/rules/${found.id}`)
      return 0
    }
  } catch {
    // an answer that is no list: make it, and let GitHub say what is wrong
  }
  const made = gh(["api", "--method", "POST", `repos/${repo}/rulesets`, "--input", "-"], body)
  if (!made.ok) {
    printed(ctx, repo, body, `gh could not make the ruleset on ${repo} (${made.err.split("\n")[0] || "gh failed"})`)
    return 1
  }
  let id = ""
  try {
    id = String((JSON.parse(made.out) as { id?: number }).id ?? "")
  } catch {
    // made, with an answer that is not JSON: said without its id
  }
  ctx.out(
    `made the ruleset "${RULESET_NAME}" on ${repo}${id ? ` (${id})` : ""}: the server refuses an update, deletion or force-push of ${main} ` +
      `from anyone but the repository's admins${id ? ` — https://github.com/${repo}/rules/${id}` : ""}`,
  )
  return 0
}
