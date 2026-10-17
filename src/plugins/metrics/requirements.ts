// Performance requirements are metrics with budgets.
//
// A requirement about a time, a memory, a throughput or a size is measured on
// every recorded run only when a metric measures it: the metric names it in
// `satisfies`, and holds it to a bound. `naima check` notes a requirement whose
// text names such a measure and that no metric satisfies.

import { type Check, type Context, type Finding, type Item, label, readReadme } from "../../core/api.ts"
import type { MetricConfig } from "./index.ts"

type Named = MetricConfig & { name: string }

/**
 * The words and amounts by which a requirement names a measure: whole words, any case, in prose. A number with a
 * unit names its measure ("under 2 seconds", "at most 64 MB"); so does the name of the quantity ("latency",
 * "memory", "throughput", "bundle size").
 */
export const MEASURES: ReadonlyArray<readonly [string, RegExp]> = [
  ["time", /\b\d+(?:[.,]\d+)?\s?(?:ms|milliseconds?|µs|microseconds?|ns|nanoseconds?|s|secs?|seconds?|mins?|minutes?|hours?|h)\b/i],
  [
    "time",
    /\b(?:latency|latencies|response times?|run ?times?|running time|start-?up time|build time|wall[- ]clock|execution time|load(?:ing)? time|how long|performance|speed)\b/i,
  ],
  ["memory", /\b(?:memory|ram|heap|footprint|resident set)\b/i],
  ["throughput", /\b(?:throughput|bandwidth|per second|requests per|operations per|\d+\s?(?:rps|qps|fps|ops\/s|req\/s))\b/i],
  ["size", /\b\d+(?:[.,]\d+)?\s?(?:bytes?|kb|mb|gb|tb|kib|mib|gib|tib)\b/i],
  ["size", /\b(?:file|bundle|binary|download|package|image|install|disk|output|index|database|artifact|artefact) size\b|\bdisk space\b/i],
]

/** The first measure a text names, and the words that name it; null when it names none. */
export function namedMeasure(text: string): { measure: string; words: string } | null {
  for (const [measure, re] of MEASURES) {
    const m = re.exec(text)
    if (m) return { measure, words: m[0] }
  }
  return null
}

/** The item a reference names, or undefined: a reference no item matches, or several do. */
function resolved(ctx: Context, ref: string): Item | undefined {
  try {
    return ctx.repo.resolve(ref)
  } catch {
    return undefined
  }
}

/** A metric's `satisfies` names items; a metric that satisfies a requirement holds it to a bound. */
export const satisfiesChecked = (metricsOf: (ctx: Context) => Named[]): Check => ({
  name: "metric-satisfies",
  says: "every item a metric's `satisfies` names exists; a metric that satisfies a requirement has a budget, a floor or a baseline (a note)",
  run(ctx) {
    const out: Finding[] = []
    for (const m of metricsOf(ctx)) {
      for (const ref of m.satisfies ?? []) {
        const item = resolved(ctx, ref)
        if (!item) {
          out.push({ level: "problem", message: `metric ${m.name}: satisfies names ${ref}, which is no item, or more than one` })
          continue
        }
        if (m.atMost === undefined && m.atLeast === undefined && m.equals === undefined) {
          out.push({
            level: "note",
            item,
            message: `metric ${m.name} satisfies ${label(item)} and holds it to nothing — give it a budget (atMost), a floor (atLeast) or a baseline (equals)`,
          })
        }
      }
    }
    return out
  },
})

/** A requirement that names a time, a memory, a throughput or a size is measured by a metric that satisfies it. */
export const performanceRequirements = (metricsOf: (ctx: Context) => Named[]): Check => ({
  name: "performance-requirement-has-metric",
  says:
    "a requirement whose title or page names a measure — a time, a memory, a throughput, a size — is satisfied by a metric that measures it, with a budget (a note)",
  run(ctx) {
    const requirements = ctx.repo.items.filter((i) => i.type === "requirements" && i.meta.status !== "dropped")
    if (!requirements.length) return []
    const measured = new Set(metricsOf(ctx).flatMap((m) => (m.satisfies ?? []).map((r) => resolved(ctx, r)?.meta.id).filter(Boolean)))
    const out: Finding[] = []
    for (const req of requirements) {
      if (measured.has(req.meta.id)) continue
      const named = namedMeasure(`${req.meta.title}\n${readReadme(req)}`)
      if (!named) continue
      out.push({
        level: "note",
        item: req,
        message: `${
          label(req)
        } names a ${named.measure} ("${named.words}") and no metric measures it — declare one with a budget and "satisfies": ["${req.slug}"]`,
      })
    }
    return out
  },
})
