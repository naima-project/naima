// The names the owner gives the stops of the metro map: `naima name-stop <commit> "<name>"` keeps one in the
// tracker, a file per commit, stops/<full hash>.json, and the metro data (metro.ts) sends them with the map, so the
// rail shows each on its stop. Like any tracker addition it is written on the trunk: on a development line, or a
// branch opened from one, the write is refused (the coordination plugin's tracker-data-on-trunk hook).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import {
  beforeTextWrite,
  bool,
  type Command,
  type Context,
  findPrivate,
  gitOrNull,
  guardPrivate,
  parse,
  privateContext,
  usageError,
  writeFileAtomic,
} from "../../core/api.ts"

/** The tracker's folder of stop names. */
export const STOPS = "stops"

/** How long a stop's name may be: the map shows it beside the stop. */
export const NAME_MAX = 40

/** One stop's name, as its file holds it. */
export interface StopName {
  commit: string
  name: string
  /** The day it was named, YYYY-MM-DD. */
  on: string
}

/** Every stop's name the tracker keeps, by the commit's full hash. */
export function stopNames(ctx: Context): Record<string, string> {
  const dir = join(ctx.trackerRoot, STOPS)
  const out: Record<string, string> = {}
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const s = JSON.parse(readFileSync(join(dir, f), "utf8")) as Partial<StopName>
      if (typeof s.commit === "string" && typeof s.name === "string" && s.name.trim()) out[s.commit] = s.name
    } catch { /* a file that is not a stop's name is not one */ }
  }
  return out
}

export const nameStopCommand: Command = {
  name: "name-stop",
  says: "give a commit of the metro map a name of your own, shown on its stop from then on, kept in the tracker; --clear removes it",
  enforces:
    `the commit is one git knows, the name is one line of at most ${NAME_MAX} characters with no private infrastructure in it, and it is written on the trunk, as every tracker addition is: refused on a development line`,
  usage: 'name-stop <commit> "<name>" | name-stop <commit> --clear',
  options: [{ name: "--clear", says: "remove the commit's name" }],
  examples: ['name-stop 3ab303aa "First public beta"', "name-stop 3ab303aa --clear"],
  run(args, ctx) {
    const p = parse(args, { clear: { type: "boolean" } })
    const [commit, ...words] = p.positionals
    const clear = bool(p, "clear")
    const name = words.join(" ").trim()
    if (!commit || (clear ? words.length > 0 : !name)) throw usageError(this)
    const hash = gitOrNull(ctx.root, "rev-parse", "--verify", "--quiet", `${commit}^{commit}`)
    if (!hash) throw new Error(`name-stop: git knows no commit ${JSON.stringify(commit)}`)
    if (/[\r\n]/.test(name)) throw new Error("name-stop: a stop's name is one line")
    if (name.length > NAME_MAX) throw new Error(`name-stop: a stop's name is at most ${NAME_MAX} characters, got ${name.length}`)
    const file = join(ctx.trackerRoot, STOPS, `${hash}.json`)
    const record = beforeTextWrite(ctx, "a stop's name")
    if (clear) {
      if (!existsSync(file)) {
        ctx.out(`${hash.slice(0, 8)} has no name`)
        return 0
      }
      rmSync(file)
      ctx.out(`removed the name of ${hash.slice(0, 8)}`)
      return 0
    }
    const allowance = guardPrivate("the stop's name", findPrivate(name, privateContext()), ctx.allowPrivate)
    mkdirSync(join(ctx.trackerRoot, STOPS), { recursive: true })
    const on = ctx.now().toISOString().slice(0, 10)
    writeFileAtomic(file, JSON.stringify({ commit: hash, name, on, ...record, ...(allowance ? { allowance } : {}) }, null, 2) + "\n")
    ctx.out(`named ${hash.slice(0, 8)} ${JSON.stringify(name)}: ${ctx.trackerDir}/${STOPS}/${hash}.json`)
    return 0
  },
}
