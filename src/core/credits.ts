// Credits: the standard way Naima credits what it uses from outside — a tool
// it installs or runs, a stance, an external plugin. Each declares an
// attribution (name, homepage, source, authors, licence, version); `naima
// credits` and the release notes print every one in use in the project.
// Provisional: the owner's decision on discussions/attribution-what-owner-means-by-what-naima.

import { attributionGaps } from "./attribution.ts"
import { versionOf } from "./updates.ts"
import type { Attribution, Context } from "./types.ts"

/** Where Naima itself is published, and by whom: the first credit, always. */
/** Its version is the one the project is locked to, filled in by `creditsOf`. */
export const NAIMA_ATTRIBUTION: Attribution = {
  name: "Naima",
  homepage: "https://naima-project.github.io/naima/",
  source: "https://github.com/naima-project/naima",
  authors: ["the Naima team"],
  license: "MIT",
  version: "",
}

/** One credit as `naima credits` prints it: the attribution, what it is to the project, and what it fails to declare. */
export interface Credit extends Attribution {
  /** What it is: Naima, a plugin from outside Naima, or the noun of the point that credits it ("credit", "tool"). */
  kind: string
  /** The plugin that declares it; absent for Naima itself. */
  plugin?: string
  /** The fields it does not declare: empty when the attribution is whole. */
  missing: string[]
}

const KIND_NAIMA = "naima"
const KIND_PLUGIN = "plugin"

/** `a` as a credit: every field a string (authors a list), what it lacks named. */
function credit(a: Partial<Attribution>, kind: string, plugin?: string): Credit {
  return {
    name: a.name ?? "",
    homepage: a.homepage ?? "",
    source: a.source ?? "",
    authors: Array.isArray(a.authors) ? a.authors : [],
    license: a.license ?? "",
    version: a.version ?? "",
    kind,
    ...(plugin ? { plugin } : {}),
    missing: attributionGaps(a),
  }
}

/**
 * Every attribution in use in the project: Naima itself, each plugin loaded from outside Naima (its own attribution,
 * or what it lacks), what any loaded plugin runs without installing it, and every tool a loaded plugin declares.
 * Each once, by name and version.
 */
export function creditsOf(ctx: Context): Credit[] {
  const out: Credit[] = []
  const seen = new Set<string>()
  const add = (c: Credit): void => {
    const key = `${c.name.toLowerCase()}@${c.version}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(c)
  }
  const version = versionOf(ctx.program, ctx.config.commit).replace(/^version /, "")
  add(credit({ ...NAIMA_ATTRIBUTION, version: version === "an untagged version" ? ctx.config.commit.slice(0, 12) : version }, KIND_NAIMA))
  for (const p of ctx.registry.plugins) {
    const entry = ctx.config.plugins[p.name]
    const external = !!(entry?.source || entry?.replacedBy)
    if (p.attribution) add(credit(p.attribution, KIND_PLUGIN, p.name))
    else if (external) add(credit({ name: p.name }, KIND_PLUGIN, p.name))
  }
  // Every point whose contributions stand for something from outside says how to credit one: the core's credits point,
  // and a plugin's own, such as the tools a plugin installs.
  for (const point of ctx.registry.points.values()) {
    if (!point.credit) continue
    for (const c of ctx.registry.contributions(point.id)) add(credit(point.credit(c.value), point.noun, c.plugin))
  }
  return out
}

const UNDECLARED = "(not declared)"
const authorsOf = (c: Credit): string => c.authors.join(", ") || UNDECLARED
const or = (v: string): string => v || UNDECLARED

/** The credits as plain text, one block each. */
export function creditsText(credits: readonly Credit[]): string[] {
  const out: string[] = []
  for (const c of credits) {
    out.push(
      `${or(c.name)} ${or(c.version)}${c.plugin ? `  (${c.kind === KIND_PLUGIN ? "" : "declared by "}plugin ${c.plugin})` : ""}`,
      `  by ${authorsOf(c)} · ${or(c.license)}`,
      `  home ${or(c.homepage)} · source ${or(c.source)}`,
    )
    if (c.missing.length) out.push(`  incomplete: it does not declare ${c.missing.join(", ")}`)
  }
  return out
}

/** The credits as a Markdown section of release notes: a heading and one line each. */
export function creditsMarkdown(credits: readonly Credit[], heading = "## Credits"): string[] {
  const link = (text: string, url: string): string => (url ? `[${text}](${url})` : text)
  return [
    heading,
    "",
    ...credits.map((c) =>
      `- ${link(or(c.name), c.homepage)} ${or(c.version)}, by ${authorsOf(c)}; ${or(c.license)}; source: ${c.source ? `<${c.source}>` : "not declared"}`
    ),
    "",
  ]
}
