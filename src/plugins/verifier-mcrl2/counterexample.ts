// A counterexample of mCRL2 as a path the Models tab replays (develop/models-tab.md §10): the evidence `pbessolve` gives
// for a violated property, printed as an `.aut` labelled transition system, read from its initial state to where it
// ends, one label per line. What the tab cannot replay is kept as a comment line, so a person reading the file sees the
// whole trace:
//
//   % origin: mCRL2 counterexample of properties/mutual-exclusion.mcf on generated/model/systems/small-refined.mcrl2, 2026-11-21
//   % the instance: pick(i_three)
//   ask(c1)
//   grant(c1)
//   ask(c2)
//   grant(c2)
//   % the property fails here: o_two(c1, c2)
//
// `tau` is left out. `pick(...)` (the instance a naima-codegen system starts by choosing) and the observers `o_...` (the
// invariants of a naima-codegen model's observers.mcrl2, which fire where one fails) are comments. A counterexample
// that ends in a loop (a property about what must happen) is written up to the state where the loop closes, and a
// comment says which step it goes back to.

/** One transition of an `.aut` file. */
export interface AutEdge {
  from: number
  label: string
  to: number
}

/** The initial state and the transitions of an `.aut` text; throws when it is not one. */
export function parseAut(text: string): { initial: number; edges: AutEdge[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const head = /^des\s*\(\s*(\d+)\s*,\s*\d+\s*,\s*\d+\s*\)$/.exec(lines[0] ?? "")
  if (!head) throw new Error("not an .aut labelled transition system: its first line is not des (initial, transitions, states)")
  const edges: AutEdge[] = []
  for (const l of lines.slice(1)) {
    const m = /^\(\s*(\d+)\s*,\s*(?:"((?:[^"\\]|\\.)*)"|([^,]*))\s*,\s*(\d+)\s*\)$/.exec(l)
    if (!m) throw new Error(`not a transition of an .aut file: ${l}`)
    edges.push({ from: Number(m[1]), label: (m[2] ?? m[3] ?? "").trim(), to: Number(m[4]) })
  }
  return { initial: Number(head[1]), edges }
}

/**
 * The labels along the counterexample: from the initial state to a state with no way on, the shortest such road; when
 * every road loops, the road taken first until it reaches a state it passed, with `loop` the index of the label the
 * loop goes back to.
 */
export function tracePath(text: string): { labels: string[]; loop: number | null } {
  const { initial, edges } = parseAut(text)
  const out = new Map<number, AutEdge[]>()
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e])
  // The shortest road to a state with nothing after it.
  const before = new Map<number, AutEdge | null>([[initial, null]])
  const queue = [initial]
  while (queue.length) {
    const s = queue.shift()!
    const next = out.get(s) ?? []
    if (!next.length) {
      const labels: string[] = []
      for (let e = before.get(s); e; e = before.get(e.from)) labels.unshift(e.label)
      return { labels, loop: null }
    }
    for (const e of next) {
      if (!before.has(e.to)) {
        before.set(e.to, e)
        queue.push(e.to)
      }
    }
  }
  // Every road loops: the first one, to the state where it closes.
  const seen = new Map<number, number>([[initial, 0]])
  const labels: string[] = []
  let s = initial
  for (;;) {
    const e = (out.get(s) ?? [])[0]!
    labels.push(e.label)
    s = e.to
    const at = seen.get(s)
    if (at !== undefined) return { labels, loop: at }
    seen.set(s, labels.length)
  }
}

/** How a label of a counterexample is written in the path: as a step, as a comment saying what it is, or left out. */
export function lineOf(label: string): string | null {
  if (label === "tau" || label === "") return null
  const action = /^([A-Za-z_][\w']*)/.exec(label)?.[1] ?? label
  if (action === "pick") return `% the instance: ${label}`
  if (/^o_/.test(action)) return `% the property fails here: ${label}`
  return label
}

/** The path file of a counterexample: its origin, then a line per label (§10), with the loop said when it ends in one. */
export function counterexamplePath(aut: string, origin: string): string {
  const { labels, loop } = tracePath(aut)
  const lines = [`% origin: ${origin}`]
  labels.forEach((l, i) => {
    if (loop !== null && i === loop) lines.push("% the loop starts here")
    const line = lineOf(l)
    if (line !== null) lines.push(line)
  })
  if (loop !== null) lines.push("% and the model goes back to where the loop starts, forever")
  return lines.join("\n") + "\n"
}
