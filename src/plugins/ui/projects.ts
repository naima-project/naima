// The view of every project Naima knows on this machine (core/projects.ts), what the new UI's home across projects
// is drawn from: for each, its name, a line of what it is (the first sentence of its README), its gates and its
// queue (what `naima gates --json` and `naima queue --json` print there), its open bugs, its failing tests (a test
// whose status refutes what it verifies) and the day of its last commit. Each is read live, with this Naima's
// plugins and its own configuration; one that cannot be read says why instead. The project the UI runs in is first.

import { readFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { type Context, contextOfProject, isOpen, isRetired, type KnownProject, knownProjects, refutes, runGit } from "../../core/api.ts"
import { runCommand } from "./bridge.ts"
import type { UiView } from "./tabs.ts"

export interface ProjectRow {
  name: string
  /** The project the UI runs in. */
  here: boolean
  says: string
  gates: unknown[]
  queue: unknown
  bugs: { ref: string; title: string; created: string }[]
  tests: { ref: string; title: string }[]
  lastChange: string | null
  error?: string
}

const quiet = { out: () => {}, err: () => {}, now: () => new Date() }

/** The first sentence of the README's first paragraph that is not a heading, a badge or a comment, at most 90 characters. */
function saysOf(root: string): string {
  let text = ""
  try {
    text = readFileSync(join(root, "README.md"), "utf8")
  } catch {
    return ""
  }
  const para = text.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^(#|!\[|\[!|<|>|```)/.test(p)) ?? ""
  const first = (para.replace(/\s+/g, " ").match(/^.*?[.!?](\s|$)/)?.[0] ?? para).trim()
  return first.length > 90 ? first.slice(0, 89).trimEnd() + "…" : first
}

const json = async (ctx: Context, words: string[]): Promise<unknown> => {
  const r = await runCommand(ctx, words)
  if (r.code !== 0) throw new Error(r.err.split("\n").filter(Boolean).at(-1) ?? `naima ${words[0]} failed`)
  return JSON.parse(r.out)
}

/** One project's row, read through `ctx`, the project's own context. */
export async function projectRow(ctx: Context, here: boolean): Promise<ProjectRow> {
  const name = basename(ctx.root)
  const head = { name, here, says: saysOf(ctx.root) }
  try {
    const [gates, queue] = [await json(ctx, ["gates", "--json"]), await json(ctx, ["queue", "--json"]).catch(() => null)]
    const items = ctx.repo.items.filter((i) => !isRetired(ctx, i))
    const ref = (i: { type: string; slug: string }) => `${i.type}/${i.slug}`
    const last = runGit(ctx.root, ["log", "-1", "--format=%cs"])
    return {
      ...head,
      gates: Array.isArray(gates) ? gates : [],
      queue,
      bugs: items.filter((i) => i.type === "bugs" && isOpen(ctx, i)).map((i) => ({
        ref: ref(i),
        title: i.meta.title,
        created: String(i.meta["created"] ?? ""),
      })),
      tests: items.filter((i) => i.type === "tests" && refutes(ctx, i)).map((i) => ({ ref: ref(i), title: i.meta.title })),
      lastChange: last.ok ? last.out.trim() || null : null,
    }
  } catch (e) {
    return { ...head, gates: [], queue: null, bugs: [], tests: [], lastChange: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Every project Naima knows here, this one first, each read in a context of its own. */
export async function projectRows(ctx: Context, known: readonly KnownProject[] = knownProjects()): Promise<ProjectRow[]> {
  const root = resolve(ctx.root)
  const others = known.filter((p) => resolve(p.root) !== root)
  const rows = [await projectRow(ctx, true)]
  for (const p of others) rows.push(await projectRow(contextOfProject(ctx, p.root, p.data, quiet), false))
  return rows
}

export const projectsView: UiView = {
  name: "projects",
  title: "All projects",
  says: "every project Naima knows on this machine, this one first: its gates, its queue, its open bugs, its failing tests and its last change",
  order: 50,
  screen: true,
  async render(_params, ctx) {
    const projects = await projectRows(ctx)
    return { data: { projects }, html: "" }
  },
}
