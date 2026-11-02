// The project as a commit had it, for /data/<view>?at=<commit>: the tracker
// read only from that commit's tree (contextAt, the one `gate show --line` reads
// a line's tip with), kept per commit so that a commit looked at screen after
// screen is read from git once. A commit is named by its hash or any ref git
// knows; one git does not know, or one no local branch reaches, is refused.

import { type Context, contextAt, gitOrNull } from "../../core/api.ts"

/** A refusal the server answers 400 with, its message said as it is. */
export class AtRefused extends Error {}

/** The commit `ref` names, when a local branch reaches it; refused plainly otherwise. */
export function commitOf(ctx: Context, ref: string): string {
  if (!/^[\w./@{}^~-]{1,200}$/.test(ref) || ref.startsWith("-")) throw new AtRefused(`naima ui: "${ref}" names no commit`)
  const sha = gitOrNull(ctx.root, "rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`)
  if (!sha) throw new AtRefused(`naima ui: no commit ${ref} in this repository`)
  const on = gitOrNull(ctx.root, "for-each-ref", "--count=1", "--contains", sha, "--format=%(refname)", "refs/heads")
  if (!on) throw new AtRefused(`naima ui: commit ${ref} is on no local branch: only a commit a branch reaches can be shown`)
  return sha
}

/** The read-only contexts of the commits looked at, the most recent kept; each removed from disk when dropped. */
export class AtCache {
  readonly #kept = new Map<string, { ctx: Context; dispose(): void }>()
  readonly size: number
  constructor(size = 8) {
    this.size = size
  }

  /** The tracker as `sha` has it. */
  get(ctx: Context, sha: string): Context {
    const hit = this.#kept.get(sha)
    if (hit) {
      this.#kept.delete(sha)
      this.#kept.set(sha, hit)
      return hit.ctx
    }
    const at = contextAt(ctx, sha)
    this.#kept.set(sha, at)
    while (this.#kept.size > this.size) {
      const [oldest, v] = this.#kept.entries().next().value!
      this.#kept.delete(oldest)
      v.dispose()
    }
    return at.ctx
  }

  get count(): number {
    return this.#kept.size
  }

  clear(): void {
    for (const v of this.#kept.values()) v.dispose()
    this.#kept.clear()
  }
}
