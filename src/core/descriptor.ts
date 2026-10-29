// A plugin's descriptor: naima-plugin.json at the root of the repository of a
// plugin from outside Naima, which says what the plugin is without running it
// — its name, its kind, its entry module, the contract it is written for, its
// examples and who made it (docs/guide/add-a-plugin.md). Naima reads it to know
// what a repository holds before loading anything (`naima stances` lists the
// stances by it), and checks, when the plugin is loaded from git, that its
// module's own manifest says the same.

import { isDeepStrictEqual } from "node:util"

/** The file at the root of an external plugin's repository that describes it. */
export const PLUGIN_DESCRIPTOR = "naima-plugin.json"

/** What naima-plugin.json says of the plugin. */
export interface PluginDescriptor {
  /** The plugin's name, as its manifest gives it by default. */
  name: string
  /** Its kind, when it has one: "stance" for a stance. */
  kind?: string
  /** The path of its module in the repository, with forward slashes. */
  entry: string
  /** The plugin contract its module is written for. */
  contract: number
  /** Paths of examples inside the repository. */
  examples?: string[]
  /** Who made it, where it is published, its licence and version, as its manifest's `attribution`. */
  attribution?: Record<string, unknown>
}

/** The descriptor `text` holds, or why it is not one. */
export function parseDescriptor(text: string): PluginDescriptor | { refusal: string } {
  let m: unknown
  try {
    m = JSON.parse(text)
  } catch {
    return { refusal: `its ${PLUGIN_DESCRIPTOR} is not valid JSON` }
  }
  const no = (what: string) => ({ refusal: `its ${PLUGIN_DESCRIPTOR} ${what}` })
  if (!m || typeof m !== "object" || Array.isArray(m)) return no("is not an object")
  const o = m as Record<string, unknown>
  if (typeof o["name"] !== "string" || !o["name"]) return no("names no plugin")
  if (typeof o["entry"] !== "string" || !o["entry"]) return no("names no entry module")
  if (typeof o["contract"] !== "number" || !Number.isInteger(o["contract"])) return no("says no contract")
  if (o["kind"] !== undefined && typeof o["kind"] !== "string") return no("gives a kind that is not a string")
  if (o["examples"] !== undefined && !(Array.isArray(o["examples"]) && o["examples"].every((e) => typeof e === "string"))) {
    return no("gives examples that are not a list of paths")
  }
  if (o["attribution"] !== undefined && (!o["attribution"] || typeof o["attribution"] !== "object" || Array.isArray(o["attribution"]))) {
    return no("gives an attribution that is not an object")
  }
  return o as unknown as PluginDescriptor
}

/**
 * Where the manifest a plugin's module made disagrees with its descriptor: each of kind, contract, examples and
 * attribution that the two give differently, and the entry when the module was loaded from another path. Empty when
 * they agree. The name is not compared: the manifest is named after the project's entry for it.
 */
export function disagreements(
  d: PluginDescriptor,
  manifest: { kind?: unknown; contract?: unknown; examples?: unknown; attribution?: unknown },
  entry: string,
): string[] {
  const out: string[] = []
  const said = (v: unknown) => (v === undefined ? "nothing" : JSON.stringify(v))
  if (d.entry !== entry) out.push(`entry: ${said(d.entry)} in ${PLUGIN_DESCRIPTOR}, the module loaded is ${said(entry)}`)
  for (const key of ["kind", "contract", "examples", "attribution"] as const) {
    if (key === "examples" && d.examples === undefined && (manifest.examples === undefined || isDeepStrictEqual(manifest.examples, []))) continue
    if (key === "attribution" && d.attribution === undefined) continue
    if (!isDeepStrictEqual(d[key], manifest[key])) out.push(`${key}: ${said(d[key])} in ${PLUGIN_DESCRIPTOR}, ${said(manifest[key])} in its manifest`)
  }
  return out
}
