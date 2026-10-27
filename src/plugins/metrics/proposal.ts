// The code-quality metrics a project starts with: `naima init`, and `naima
// update` once for a project that has never declared any, write the built-in
// presets that fit the languages its files are in, with no bound, so that
// quality is recorded from the first commit. Only `code.*` presets, measured
// in process, and `deno.lint` where a deno.json says the project uses Deno: a
// preset that runs the test suite is not proposed, since it costs a whole run.
// What is written is the owner's to keep, bound or remove; once
// `options.metrics` exists, even empty, nothing is proposed again.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { type Context, DATA_FILE, posixRelative, type Setup, writeJson } from "../../core/api.ts"
import { type Language, MANIFESTS, workingTreeSource } from "./code.ts"

/** The plugin's key in naima.json's plugins table. */
const PLUGIN_KEY = "metrics"

/** The metrics proposed for a project whose files are `files`: metric name → its preset. */
export function proposedMetrics(files: readonly string[], languages: readonly Language[]): Record<string, { preset: string }> {
  const byExt = new Map<string, Language>()
  for (const l of languages) for (const e of l.extensions) if (!byExt.has(e)) byExt.set(e, l)
  const used = new Set<Language>()
  for (const p of files) {
    const dot = p.lastIndexOf(".")
    const lang = dot > p.lastIndexOf("/") ? byExt.get(p.slice(dot).toLowerCase()) : undefined
    if (lang?.code) used.add(lang)
  }
  const names = new Set(files.map((p) => p.split("/").at(-1) ?? p))
  const out: Record<string, { preset: string }> = {}
  const add = (name: string, preset: string) => (out[name] = { preset })
  // Lines, files, duplication and markers are read in every language Naima knows.
  add("loc", "code.loc")
  add("files", "code.files")
  add("duplication", "code.duplication")
  add("todos", "code.todos")
  // Functions and their complexity only where a language of the project has a function finder.
  if ([...used].some((l) => l.functions)) {
    add("functions", "code.functions")
    add("function-size", "code.function-size")
    add("function-size-max", "code.function-size-max")
    add("complexity", "code.complexity")
    add("complexity-max", "code.complexity-max")
  }
  if (files.some((p) => MANIFESTS.has(p.split("/").at(-1) ?? p) && !p.split("/").includes("node_modules"))) add("dependencies", "code.dependencies")
  if (names.has("deno.json") || names.has("deno.jsonc")) add("lint", "deno.lint")
  return out
}

/** The setup step: the proposal, written into naima.json where the project has no `metrics` option yet. */
export const metricsSetup = (languages: (ctx: Context) => Language[]): Setup => ({
  name: "code-metrics",
  says:
    "the built-in code-quality metrics that fit the project's languages, with no bounds, declared where plugins.metrics.options has no metrics yet: once, so a project whose owner removed them is not proposed them again",
  install(ctx) {
    const file = join(ctx.trackerRoot, DATA_FILE)
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
    const plugins = { ...(raw["plugins"] as Record<string, unknown> | undefined) }
    const entry = { ...(plugins[PLUGIN_KEY] as Record<string, unknown> | undefined) }
    const options = { ...(entry["options"] as Record<string, unknown> | undefined) }
    if (Object.hasOwn(options, "metrics")) return []
    const metrics = proposedMetrics(workingTreeSource(ctx.root, [ctx.trackerDir]).files, languages(ctx))
    options["metrics"] = metrics
    entry["options"] = options
    plugins[PLUGIN_KEY] = entry
    writeJson(file, { ...raw, plugins })
    const config = posixRelative(ctx.root, file)
    return [
      `declared ${Object.keys(metrics).length} code-quality metrics, with no bounds, in ${config} (${
        Object.keys(metrics).join(", ")
      }): naima metrics run --record records them; to remove them, delete them from plugins.metrics.options.metrics and leave it {}, which is never proposed again`,
    ]
  },
})
