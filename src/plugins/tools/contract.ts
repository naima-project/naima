// The point this plugin declares: a tool a plugin needs, which Naima installs
// into its own directory on the machine it runs on
// (specs/tools-plugin-declares-tools-needs-naima-tools, §1). Any plugin
// contributes one under `contributes.tools`.

import { code, type ExtensionPoint, PLATFORMS, table } from "../../core/api.ts"

/** How an artefact is unpacked (§4, step 4). */
export type Format = "zip" | "tar.gz" | "dmg" | "deb" | "pip"
export const FORMATS: readonly Format[] = ["zip", "tar.gz", "dmg", "deb", "pip"]

/** An artefact a platform installs from. */
export interface Source {
  /** Where it is downloaded from; for `pip`, a description of the index the requirements come from. */
  url: string
  /** Its size in bytes: for `pip`, the wheels', said at the consent. */
  size: number
  /** Its sha256, in hex; for `pip` the requirement lines carry theirs. */
  sha256?: string
  /** Bytes on disk once unpacked, when known: said at the consent. */
  unpacked?: number
  format: Format
  /** The directory inside the install that holds the tool's programs. */
  bin: string
  /** For `dmg`: the application bundle copied out of the image. */
  app?: string
  /** For `pip`: the tool whose Python makes the venv. */
  python?: string
  /** For `pip`: the requirement lines, each pinned with `==` and its `--hash=sha256:`es. */
  requirements?: string[]
}

/** A platform the tool has no artefact for: why, and what to do instead. */
export interface Unavailable {
  unavailable: string
}

/** A tool a plugin needs, pinned to one version. */
export interface ToolDeclaration {
  name: string
  title: string
  says: string
  version: string
  /** The licence's SPDX identifier, and a sentence when the artefact bundles others. */
  licence: string
  homepage: string
  /** Where its source is published: part of its attribution, which `naima credits` prints (provisional). */
  source?: string
  /** Its authors, by name when they are few, otherwise the team or organisation: part of its attribution (provisional). */
  authors?: string[]
  /** Tools installed first. */
  needs?: string[]
  /** The programs it provides, by name. */
  programs: string[]
  /** How an install is checked: a program of `programs`, its arguments, and a string its output must contain. */
  verify: { program: string; args: string[]; expect: string }
  /** Per platform key (`darwin-arm64`…): a source, or the answer saying why there is none. */
  platforms: Partial<Record<(typeof PLATFORMS)[number], Source | Unavailable>>
}

export const isUnavailable = (s: Source | Unavailable): s is Unavailable => "unavailable" in s

const NAME = /^[a-z][a-z0-9-]*$/
const SHA256 = /^[0-9a-f]{64}$/
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== ""

/** Why `s`, the source declared for `platform`, is not one, or null. */
function sourceRefusal(platform: string, s: unknown): string | null {
  if (!s || typeof s !== "object") return `platform ${platform} is neither a source nor an answer`
  const o = s as Partial<Source> & Partial<Unavailable>
  if ("unavailable" in o) return nonEmpty(o.unavailable) ? null : `platform ${platform}: unavailable must say why, and what to do instead`
  if (!FORMATS.includes(o.format as Format)) return `platform ${platform}: format must be one of ${FORMATS.join(", ")}`
  if (!nonEmpty(o.url)) return `platform ${platform}: the source has no url`
  if (typeof o.size !== "number" || !(o.size > 0)) return `platform ${platform}: the source has no size, in bytes`
  if (typeof o.bin !== "string") return `platform ${platform}: the source has no bin, the directory of its programs inside the install`
  if (o.format === "pip") {
    if (!nonEmpty(o.python)) return `platform ${platform}: a pip source names the python tool it installs with`
    if (!Array.isArray(o.requirements) || !o.requirements.length) return `platform ${platform}: a pip source has its requirement lines`
    const loose = o.requirements.find((r) => typeof r !== "string" || !/==/.test(r) || !/--hash=sha256:[0-9a-f]{64}/.test(r))
    if (loose !== undefined) return `platform ${platform}: requirement ${JSON.stringify(loose)} is not pinned with == and its --hash=sha256:`
    return null
  }
  if (!SHA256.test(o.sha256 ?? "")) return `platform ${platform}: the source has no sha256, 64 hex digits`
  if (o.format === "dmg" && !nonEmpty(o.app)) return `platform ${platform}: a dmg source names the app it copies out of the image`
  return null
}

/** Why `t` is not a tool declaration, or null: checked when the project loads (§1). */
export function declarationRefusal(t: unknown): string | null {
  const d = t as Partial<ToolDeclaration> | null
  if (!d || typeof d !== "object" || !nonEmpty(d.name) || !NAME.test(d.name)) return "has no name: one lowercase word"
  for (const k of ["title", "says", "version", "licence", "homepage"] as const) if (!nonEmpty(d[k])) return `has no ${k}`
  if (d.source !== undefined && !nonEmpty(d.source)) return "has a source that is not a URL"
  if (d.authors !== undefined && (!Array.isArray(d.authors) || !d.authors.length || !d.authors.every(nonEmpty))) {
    return "has authors that are not a list of names"
  }
  if (!Array.isArray(d.programs) || !d.programs.length || !d.programs.every(nonEmpty)) return "has no programs"
  if (d.needs !== undefined && (!Array.isArray(d.needs) || !d.needs.every((n) => typeof n === "string" && NAME.test(n)))) {
    return "has needs that are not tool names"
  }
  const v = d.verify
  if (!v || !nonEmpty(v.program) || !Array.isArray(v.args) || !nonEmpty(v.expect)) {
    return "has no verify: a program, its arguments and what its output must contain"
  }
  if (!d.programs.includes(v.program)) return `verifies with ${v.program}, which is not one of its programs`
  if (!d.platforms || typeof d.platforms !== "object") return "has no platforms"
  for (const [platform, s] of Object.entries(d.platforms)) {
    if (!(PLATFORMS as readonly string[]).includes(platform)) return `names the platform ${platform}, not one of ${PLATFORMS.join(", ")}`
    const why = sourceRefusal(platform, s)
    if (why) return why
  }
  return null
}

export const toolsPoint: ExtensionPoint<ToolDeclaration> = {
  id: "tools",
  says:
    "a tool a plugin needs, which `naima tools install` installs into Naima's own directory: name, exact version, licence, homepage, source and authors (its attribution, which `naima credits` prints), programs, how an install is verified, and per platform a source (url, size, sha256, format) or the answer saying why there is none",
  noun: "tool",
  key: (t) => t.name,
  validate: declarationRefusal,
  credit: (t) => ({ name: t.title, homepage: t.homepage, source: t.source ?? "", authors: t.authors ?? [], license: t.licence, version: t.version }),
  gaps: (t) => [
    ...(nonEmpty(t.says) ? [] : ["does not say what it is"]),
    ...(t.authors?.length ? [] : ["does not name its authors, for naima credits"]),
    ...(nonEmpty(t.source) ? [] : ["does not say where its source is published, for naima credits"]),
  ],
  document: (ts) => [
    "",
    "**Tools**, installed by `naima tools install`",
    ...table(
      ["Tool", "Version", "Licence", "Platforms"],
      ts.map((t) => [code(t.name), t.version, t.licence, Object.entries(t.platforms).map(([p, s]) => (s && isUnavailable(s) ? `${p} (none)` : p)).join(", ")]),
    ),
  ],
}
