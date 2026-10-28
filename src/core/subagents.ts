// Every sub-agent reads the project's rules before it acts
// (requirements/every-worker-sub-agent-reads-project-s), held by the agent
// tool's hooks where it has them (adapters/). When a sub-agent starts, naima
// subagent --hook <tool> puts the rules for agents in its context and leaves
// a mark, by its id, that it has them; the tool's guard on its calls holds
// one that acts until such a mark exists, and marks a naima rules command as
// it passes; the hook on its stop sends one that never had them back to read
// them. The marks are kept outside the repository, beside the tick's state:
//
//   <git common dir>/naima/subagents/
//     <agent id>         the sub-agent has the rules: "given" or "read"
//     <agent id>.held    a call of it was held for want of them
//     skipped            one line per sub-agent that stopped without them

import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { runGit } from "./git.ts"

/** An agent id as the marks name it: letters, digits, dot, dash and underscore only; anything else is no id. */
export const AGENT_ID = /^[A-Za-z0-9_.-]+$/

/** The folder of the marks, in the clone's git directory; null outside a git repository. */
export function subagentsDir(root: string): string | null {
  const r = runGit(root, ["rev-parse", "--git-common-dir"])
  return r.ok && r.out.trim() ? join(resolve(root, r.out.trim()), "naima", "subagents") : null
}

/** Mark that the sub-agent `id` has the rules, and how; false when it cannot be marked. */
export function markRules(root: string, id: string, how: "given" | "read"): boolean {
  if (!AGENT_ID.test(id)) return false
  const dir = subagentsDir(root)
  if (!dir) return false
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, id), how + "\n")
    return true
  } catch {
    return false
  }
}

/** What a starting sub-agent is told, before the rules themselves. */
export const SUBAGENT_PREAMBLE =
  "You are a sub-agent in a project that Naima tracks. These are the project's rules for agents, given to you as you start (the same as naima rules --audience agents prints); they bind you exactly as they bind the agent that started you. Obey them from your first action."
