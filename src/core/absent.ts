// An item a command names that this checkout does not hold, though the trunk or the development line does: the
// item was filed there after this branch was cut or last merged, and reaches the branch with the line's next
// sync and a merge of it. "no item matches" alone sends a worker to look for a cache; this says where the item is.

import { developmentLine } from "./trunk-only.ts"
import { runGit, trunk } from "./git.ts"
import type { Context, Item } from "./types.ts"

/** Where else the item might be held, as git names the refs: the trunk, and the development line, here and on origin. */
function otherRevs(ctx: Context): string[] {
  const main = trunk(ctx.trackerGit)
  const on = developmentLine(ctx.root)
  const revs = [main, on ? `origin/${on.line}` : null, on ? on.line : null]
  return revs.filter((r): r is string => !!r)
}

/** The items `ref` could name in the tracker as `rev` has it, each as `<type dir>/<slug>`. */
function heldAt(ctx: Context, rev: string, ref: string): string[] {
  const prefix = ctx.trackerPrefix ? `${ctx.trackerPrefix}/` : ""
  const slug = ref.includes("/") ? ref.slice(ref.indexOf("/") + 1) : ref
  const found: string[] = []
  for (const type of ctx.registry.types.values()) {
    const listed = runGit(ctx.trackerGit, ["ls-tree", "--name-only", `${rev}:${prefix}${type.dir}`])
    if (!listed.ok) continue
    for (const name of listed.out.split("\n")) {
      if (name && (name === slug || (!ref.includes("/") && name.includes(slug)))) found.push(`${type.dir}/${name}`)
    }
  }
  return found
}

/**
 * The item `ref` names in this checkout. When none does, the error says so as `resolve` does, and adds where the
 * trunk or the line holds an item of that name and how it gets here, when one does.
 */
export function resolveHere(ctx: Context, ref: string): Item {
  try {
    return ctx.repo.resolve(ref)
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith("no item matches") || !ref.trim()) throw e
    const prefix = ctx.trackerPrefix ? `${ctx.trackerPrefix}/` : ""
    for (const rev of otherRevs(ctx)) {
      const held = heldAt(ctx, rev, ref)
      if (!held.length) continue
      const shown = held.slice(0, 3).join(", ")
      throw new Error(
        `${e.message} in this checkout, which does not hold it yet: ${rev} has ${shown}, filed after this branch was cut or last merged. ` +
          `It arrives with the line's next sync (naima line sync) and a merge of it into this branch; to take it now: git checkout ${rev} -- ${prefix}${
            held[0]
          }`,
      )
    }
    throw e
  }
}
