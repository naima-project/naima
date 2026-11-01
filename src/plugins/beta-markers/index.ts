// What was shipped without proof, and whether the code still says so.
//
// A marker is a comment in the project's own source naming the item whose
// passing would prove the marked behaviour:
//
//   // naima:beta tests/export-keeps-alpha  export of layered files is unproven
//
// A marker is wrong in two ways. It names nothing (a problem), or it outlives
// its proof — the item it names has passed or been archived (a problem too: a
// stale marker teaches readers that the marker means nothing, and then the
// real ones stop being read).
//
// Always on, and nothing to list: by default it scans every source file git
// tracks. Overrides, all optional: { "paths": ["src"], "extensions": [".ts"],
// "pattern": "<regex with groups ref and what>" }

import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  bool,
  type Check,
  type Command,
  type Context,
  CONTRACT,
  fieldValue,
  type Finding,
  isOpen,
  type Item,
  label,
  NEVER_SOURCE,
  parse,
  type Plugin,
  posixRelative,
  projectFiles,
  proves,
  rendered,
  type SummarySection,
  walkFiles,
} from "../../core/api.ts"

export interface Marker {
  file: string
  line: number
  ref: string
  what: string
}

export interface MarkerOptions {
  /** Files or directories to scan; unset, every file of the project (see projectFiles). */
  paths?: string[]
  extensions: string[]
  pattern: RegExp
}

/** The trackers' archive field, read by name: where a closed item came from. */
const CLOSED_FROM = { name: "closedFrom", kind: "string" } as const
const DEFAULT_PATTERN = String.raw`^\s*(?:\/\/|#|--|;|\*)\s*naima:beta\s+(?<ref>\S+)\s*(?<what>.*)$`

function readOptions(o: Record<string, unknown>): MarkerOptions {
  const list = (v: unknown, fallback: string[]): string[] => (Array.isArray(v) && v.every((x) => typeof x === "string") ? v : fallback)
  return {
    ...(o["paths"] !== undefined ? { paths: list(o["paths"], []) } : {}),
    extensions: list(o["extensions"], [".ts", ".tsx", ".js", ".mjs", ".py", ".rs", ".go", ".java", ".c", ".h"]),
    pattern: new RegExp(typeof o["pattern"] === "string" ? o["pattern"] : DEFAULT_PATTERN),
  }
}

/** The files to scan: under the paths option, or every project file, with a scanned extension. */
function scanned(root: string, opts: MarkerOptions, program?: string): string[] {
  const wanted = (f: string): boolean => opts.extensions.some((x) => f.endsWith(x))
  if (opts.paths) return opts.paths.flatMap((base) => walkFiles(join(root, base))).filter(wanted)
  return projectFiles(root, program)
    .filter((f) => wanted(f) && !f.split(/[\\/]/).some((part) => NEVER_SOURCE.has(part)))
    .map((f) => join(root, f))
}

/** The markers in the project's files; never in `program`, the Naima that runs. */
export function scanMarkers(root: string, opts: MarkerOptions, program?: string): Marker[] {
  const out: Marker[] = []
  for (const path of scanned(root, opts, program)) {
    readFileSync(path, "utf8")
      .split("\n")
      .forEach((text, i) => {
        const m = text.match(opts.pattern)
        const ref = m?.groups?.["ref"]
        if (ref) out.push({ file: posixRelative(root, path), line: i + 1, ref, what: (m?.groups?.["what"] ?? "").trim() })
      })
  }
  return out
}

type State = { marker: Marker; item?: Item; why?: string; state: "unproven" | "stale" | "dangling" }

/**
 * The item a marker names, or why it names none. A `type/slug` written before
 * the item was archived still finds it: the archive keeps the slug, and
 * `closedFrom` the type it came from.
 */
function resolveMarker(ctx: Context, ref: string): { item: Item } | { why: string } {
  try {
    return { item: ctx.repo.resolve(ref) }
  } catch (e) {
    const [type, slug, ...rest] = ref.split("/")
    const archived = slug && !rest.length ? ctx.repo.items.filter((i) => i.slug === slug && fieldValue(i, CLOSED_FROM) === type) : []
    if (archived.length === 1 && archived[0]) return { item: archived[0] }
    return { why: e instanceof Error ? e.message : String(e) }
  }
}

function audit(ctx: Context, opts: MarkerOptions): State[] {
  return scanMarkers(ctx.root, opts, ctx.program).map((marker): State => {
    const found = resolveMarker(ctx, marker.ref)
    if ("why" in found) return { marker, why: found.why, state: "dangling" }
    return { marker, item: found.item, state: proves(ctx, found.item) || !isOpen(ctx, found.item) ? "stale" : "unproven" }
  })
}

export default function betaMarkers(options: Record<string, unknown> = {}): Plugin {
  const opts = readOptions(options)
  const where = (m: Marker) => `${m.file}:${m.line}`

  const check: Check = {
    name: "beta-markers",
    says: "every marker names an open item; none outlives its proof",
    run: (ctx) =>
      audit(ctx, opts)
        .filter((s) => s.state !== "unproven")
        .map((s): Finding => ({
          level: "problem",
          message: s.state === "dangling"
            ? `${where(s.marker)}: beta marker names "${s.marker.ref}", ${
              s.why?.startsWith("no item matches") ? "which is no item" : `which does not resolve: ${s.why}`
            }`
            : `${where(s.marker)}: beta marker outlived its proof — ${label(s.item as Item)} is ${s.item?.meta.status}; remove the marker`,
        })),
  }

  const command: Command = {
    name: "beta",
    says: "list what is marked as shipped without proof, and the state of each proof",
    enforces: "nothing: it only reads",
    usage: "beta [--check]",
    options: [{ name: "--check", says: "exit 1 when a marker is stale or dangling" }],
    examples: ["beta", "beta --check"],
    run(args, ctx) {
      const p = parse(args, { check: { type: "boolean" } })
      const states = audit(ctx, opts)
      for (const s of states) ctx.out(`  ${s.state.padEnd(9)} ${where(s.marker)}  ${s.marker.ref}  ${s.marker.what}`)
      const bad = states.filter((s) => s.state !== "unproven").length
      ctx.out(`${states.length} markers, ${bad} stale or dangling`)
      return bool(p, "check") && bad ? 1 : 0
    },
  }

  const summary: SummarySection = {
    name: "shipped without proof",
    render(ctx) {
      const states = audit(ctx, opts)
      const data = { markers: states.length, staleOrDangling: states.filter((s) => s.state !== "unproven").length }
      return rendered(data, (d) => (d.markers ? [`  ${d.markers} beta markers, ${d.staleOrDangling} stale or dangling`] : []))
    },
  }

  return {
    name: "beta-markers",
    contract: CONTRACT,
    says: "markers in the code for behaviour shipped without proof",
    about:
      "A marker is a comment in the project's own source naming the item whose passing would prove the marked behaviour: `// naima:beta tests/export-keeps-alpha  export of layered files is unproven`. " +
      "Always on: it scans every source file of the project, so a marker anywhere is held without listing where to look. " +
      "A marker names its item as any item reference; a `type/slug` written before the item was archived still finds it in the archive. " +
      "A marker is wrong in two ways: it names nothing (dangling, said with why), or it outlives its proof — the item it names has passed or is no longer open (stale). Both fail `naima check`: a stale marker teaches readers that markers mean nothing.",
    options: [
      {
        name: "paths",
        says: "files or directories, from the project root, to scan instead of the whole project",
        default: "every file git tracks or would track (outside git, every file under the root but hidden directories, node_modules, dist and build)",
      },
      { name: "extensions", says: "file extensions to scan", default: '[".ts", ".tsx", ".js", ".mjs", ".py", ".rs", ".go", ".java", ".c", ".h"]' },
      {
        name: "pattern",
        says: "a regular expression with named groups ref and what, matched against each line",
        default: "a comment (//, #, --, ;, *) followed by naima:beta <ref> <what>",
      },
    ],
    checks: [check],
    commands: [command],
    summary: [summary],
    // A marker written before its item was archived finds it through the archive's record of where it came from.
    uses: { fields: [CLOSED_FROM.name] },
  }
}
