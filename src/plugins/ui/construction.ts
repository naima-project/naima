// What the UI tab says of the project's UI construction, the foundational element of Naima's UI: the UI stance the app
// is built with, the commit it is pinned at, the mood and the tokens it draws with, the widgets it is made of (the
// stance's gallery) and the state of the stance's checks (the record `stance-ui.checked.json` they leave beside
// `stance-ui.json`). Read from the project's files, nothing run: a card that reads a record, never one that waits.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { projectFiles } from "../../core/api.ts"

export interface Construction {
  stance: { name: string; version: string | null; commit: string | null }
  mood: string | null
  /** The tokens of the app's token folder: how many, in which groups, and the themes with their own. */
  tokens: { total: number; groups: { name: string; count: number }[]; themes: string[] }
  /** The mood board's colours: each colour token, as the CSS custom property the build gives it (`color.home.hairline`
   * is `--color-home-hairline`), which the page draws in the theme it shows. */
  palette: string[]
  /** The widgets of the app, by the folder of the widget set they are in. */
  widgets: { name: string; group: string }[]
  /** What the checks found the last time they ran in this checkout; none when they never ran here. */
  checks: { name: string; state: "passes" | "fails"; problems: number; at: string }[]
}

const json = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** The leaves of a design-tokens tree (the nodes with a `$value`), counted by top-level group. */
function leaves(node: unknown): number {
  if (!node || typeof node !== "object" || Array.isArray(node)) return 0
  const o = node as Record<string, unknown>
  if ("$value" in o) return 1
  return Object.entries(o).reduce((n, [k, v]) => n + (k.startsWith("$") ? 0 : leaves(v)), 0)
}

function tokensOf(folder: string): Construction["tokens"] {
  const groups = new Map<string, number>()
  const add = (file: string, into = groups) => {
    const tree = json(file)
    if (!tree || typeof tree !== "object") return
    for (const [name, sub] of Object.entries(tree as Record<string, unknown>)) {
      if (!name.startsWith("$")) into.set(name, (into.get(name) ?? 0) + leaves(sub))
    }
  }
  const themes: string[] = []
  try {
    for (const f of readdirSync(folder).sort()) {
      if (f.endsWith(".tokens.json")) add(join(folder, f))
    }
    const themesDir = join(folder, "themes")
    if (isDir(themesDir)) {
      for (const t of readdirSync(themesDir).sort()) {
        if (isDir(join(themesDir, t))) themes.push(t)
      }
      // The groups a theme gives are the colours and the shadows: counted once, from the theme that gives the most.
      let best = new Map<string, number>()
      let bestTotal = -1
      for (const t of themes) {
        const g = new Map<string, number>()
        for (const f of readdirSync(join(themesDir, t)).sort()) if (f.endsWith(".tokens.json")) add(join(themesDir, t, f), g)
        const total = [...g.values()].reduce((n, x) => n + x, 0)
        if (total > bestTotal) [best, bestTotal] = [g, total]
      }
      for (const [k, n] of best) groups.set(k, (groups.get(k) ?? 0) + n)
    }
  } catch {
    // A folder that cannot be read has no tokens to count.
  }
  const list = [...groups.entries()].filter(([, n]) => n > 0).map(([name, count]) => ({ name, count })).sort((a, b) =>
    b.count - a.count || a.name.localeCompare(b.name)
  )
  return { total: list.reduce((n, g) => n + g.count, 0), groups: list, themes }
}

/** The colour tokens of a token folder and its themes, each once, as CSS custom properties: the path of each leaf of a
 * `color` group joined by dashes, in the order the files declare them (the themes by name). */
export function paletteOf(folder: string): string[] {
  const out: string[] = []
  const walk = (node: unknown, path: string[]): void => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return
    const o = node as Record<string, unknown>
    if ("$value" in o) return void out.push(`--${path.join("-")}`)
    for (const [k, v] of Object.entries(o)) if (!k.startsWith("$")) walk(v, [...path, k])
  }
  try {
    const themesDir = join(folder, "themes")
    const themes = isDir(themesDir) ? readdirSync(themesDir).sort().filter((t) => isDir(join(themesDir, t))).map((t) => join(themesDir, t)) : []
    for (const dir of [folder, ...themes]) {
      for (const f of readdirSync(dir).sort()) {
        if (!f.endsWith(".tokens.json")) continue
        const tree = json(join(dir, f))
        if (tree && typeof tree === "object" && "color" in tree) walk((tree as Record<string, unknown>)["color"], ["color"])
      }
    }
  } catch {
    // A folder that cannot be read has no colours to show.
  }
  return [...new Set(out)]
}

/** The .svelte files under a folder, by the widget set's folder they are in (the files of a sub-folder under its name). */
function widgetsUnder(dir: string, group: string, out: Construction["widgets"]): void {
  let names: string[]
  try {
    names = readdirSync(dir).sort()
  } catch {
    return
  }
  for (const n of names) {
    const p = join(dir, n)
    if (isDir(p)) widgetsUnder(p, n, out)
    else if (n.endsWith(".svelte")) out.push({ name: n.slice(0, -".svelte".length), group })
  }
}

/** The UI construction the project's stance-ui.json declares, or null when it declares none. */
export function construction(root: string, program?: string): Construction | null {
  const file = projectFiles(root, program).find((f) => basename(f) === "stance-ui.json")
  if (!file) return null
  const abs = resolve(root, file)
  const decl = json(abs) as {
    stance?: { name?: unknown; version?: unknown; commit?: unknown }
    mood?: unknown
    check?: { tokens?: unknown; widgets?: unknown }
  } | null
  if (!decl || typeof decl !== "object") return null
  const dir = dirname(abs)
  const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null)
  const widgets: Construction["widgets"] = []
  for (const w of Array.isArray(decl.check?.widgets) ? decl.check.widgets : []) {
    if (typeof w !== "string") continue
    const p = join(dir, w)
    if (isDir(p)) widgetsUnder(p, basename(w), widgets)
  }
  // The same widget set may be named by two folders: each widget once.
  const seen = new Set<string>()
  const once = widgets.filter((w) => !seen.has(`${w.group}/${w.name}`) && seen.add(`${w.group}/${w.name}`))
  const recorded = json(join(dir, "stance-ui.checked.json"))
  const checks: Construction["checks"] = []
  if (recorded && typeof recorded === "object") {
    for (const [name, run] of Object.entries(recorded as Record<string, { passed?: unknown; problems?: unknown; at?: unknown }>)) {
      if (!run || typeof run !== "object") continue
      checks.push({
        name,
        state: run.passed === true ? "passes" : "fails",
        problems: typeof run.problems === "number" ? run.problems : 0,
        at: str(run.at) ?? "",
      })
    }
  }
  const tokens = str(decl.check?.tokens)
  return {
    stance: { name: str(decl.stance?.name) ?? "ui", version: str(decl.stance?.version), commit: str(decl.stance?.commit) },
    mood: str(decl.mood),
    tokens: tokens && existsSync(join(dir, tokens)) ? tokensOf(join(dir, tokens)) : { total: 0, groups: [], themes: [] },
    palette: tokens && existsSync(join(dir, tokens)) ? paletteOf(join(dir, tokens)) : [],
    widgets: once,
    checks,
  }
}
