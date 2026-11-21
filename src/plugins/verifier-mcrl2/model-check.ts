// `naima model-check`: checks property files on an mCRL2 specification with the mcrl2 verifier, outside any property
// item, and keeps each counterexample as a path the Models tab replays (counterexample.ts). The Models tab's Check runs
// it under `naima run` (develop/models-tab.md §15); a person may run it by hand. It records nothing in the tracker: a
// property that must hold for the project is a property item, decided by `naima verify`.

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path"
import { type Command, type Context, parse, progressFor, str, usageError } from "../../core/api.ts"
import { counterexamplePath } from "./counterexample.ts"

/** What the verifier gives back, as this command reads it. */
interface Result {
  verdict: "holds" | "violated" | "error" | "unknown"
  output: string
  counterexample?: string
}

/** The verifier this command runs: the plugin's mcrl2 verifier. */
export interface Checker {
  verify(
    request: { model: string; property: string; options: Record<string, unknown>; progress?: ReturnType<typeof progressFor> },
    ctx: Context,
  ): Promise<Result>
}

/** The prefix of the last line, which carries every result as JSON for a program that reads the log (the Models tab). */
export const RESULT_LINE = "model-check result:"

const inProject = (root: string, path: string): string | null => {
  const r = relative(root, resolve(root, path))
  return r.startsWith("..") || isAbsolute(r) ? null : r.split(sep).join("/")
}

export function modelCheck(checker: Checker): Command {
  return {
    name: "model-check",
    says:
      "check property files (.mcf) on an mCRL2 specification with the mcrl2 verifier, outside any property item, and keep the counterexample of each violated one as a path the Models tab replays",
    enforces:
      "nothing: it records no verdict in the tracker (a property the project holds to is a property item, decided by naima verify); it writes only the counterexample paths, one file per violated property in the folder --paths names, inside the project",
    usage: 'model-check <specification> <property.mcf>... [--paths <folder>] [--origin "<words>"]',
    long: {
      reports:
        "the properties done of those asked, and within one each tool of the verifier with the count it exposes (the BES equations pbessolve generates), into the run's progress file under naima run",
    },
    options: [
      {
        name: "--paths",
        says:
          "the folder, from the project root, where the counterexample of a violated property is written as <property>.trace: one label per line, what the tab cannot replay as comment lines, the first line % origin",
      },
      { name: "--origin", says: "words added to each counterexample's origin line, such as the study it was checked for" },
    ],
    examples: [
      "model-check generated/model/systems/small-refined.mcrl2 properties/mutual-exclusion.mcf --paths paths",
      "model-check model.mcrl2 properties/no-deadlock.mcf properties/progress.mcf",
    ],
    async run(args, ctx) {
      const p = parse(args, { paths: { type: "string" }, origin: { type: "string" } })
      const [spec, ...properties] = p.positionals
      if (!spec || !properties.length) throw usageError(this)
      const specRel = inProject(ctx.root, spec)
      if (specRel === null) throw new Error(`the specification ${spec} is outside the project`)
      if (!existsSync(resolve(ctx.root, specRel))) throw new Error(`the specification ${spec} does not exist`)
      const pathsArg = str(p, "paths")
      const paths = pathsArg === undefined ? null : inProject(ctx.root, pathsArg)
      if (pathsArg !== undefined && paths === null) throw new Error(`the folder ${pathsArg} is outside the project`)
      const origin = str(p, "origin")
      const progress = progressFor((l) => ctx.err(l))
      const results: { property: string; verdict: string; path?: string; output?: string }[] = []
      try {
        for (const [i, property] of properties.entries()) {
          progress.overall(i, properties.length, "properties")
          const rel = inProject(ctx.root, property)
          if (rel === null || !existsSync(resolve(ctx.root, rel))) {
            ctx.out(`${property}: error — the property file does not exist in the project`)
            results.push({ property, verdict: "error", output: "the property file does not exist in the project" })
            continue
          }
          progress.note(rel)
          const r = await checker.verify({ model: resolve(ctx.root, specRel), property: rel, options: {}, progress }, ctx)
          const row: (typeof results)[number] = { property: rel, verdict: r.verdict }
          if (r.verdict === "violated" && paths !== null && r.counterexample?.startsWith("des")) {
            const name = basename(rel).replace(/\.mcf$/, "") + ".trace"
            const folder = resolve(ctx.root, paths)
            mkdirSync(folder, { recursive: true })
            const day = ctx.now().toISOString().slice(0, 10)
            const said = `mCRL2 counterexample of ${rel} on ${specRel}, ${day}${origin ? `, ${origin}` : ""}`
            try {
              writeFileSync(join(folder, name), counterexamplePath(r.counterexample, said))
              row.path = `${paths}/${name}`
            } catch (e) {
              row.output = `the counterexample could not be read as a path: ${e instanceof Error ? e.message : String(e)}`
            }
          }
          if (r.verdict === "error" || r.verdict === "unknown") row.output = r.output.split("\n").slice(-8).join("\n")
          ctx.out(`${rel}: ${r.verdict}${row.path ? ` — counterexample in ${row.path}` : ""}`)
          if (row.output) ctx.out(row.output)
          results.push(row)
        }
        progress.overall(properties.length, properties.length, "properties")
      } finally {
        progress.end()
      }
      ctx.out(`${RESULT_LINE} ${JSON.stringify({ specification: specRel, results })}`)
      return results.every((r) => r.verdict === "holds") ? 0 : 1
    },
  }
}
