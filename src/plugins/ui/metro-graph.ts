// The commits a git question is about, read once and answered in memory: the map asks about every branch (which line it
// belongs to, where it left, where it rejoined, its own commits), and a git process each costs 8 ms on macOS and 35 ms or
// more on Windows (bugs/rail-s-project-map-makes-about-771). The commits the trunk lacks, with their parents, times,
// authors and subjects, come from one `git log`; a question about two of them is a walk over that graph. A commit the
// trunk has is outside the graph, and the walks never leave it: what the trunk has is one set, and every question is
// asked of the part that is not in it.

/** One commit of the graph. */
export interface GraphCommit {
  /** Its parents, the first parent first. */
  parents: string[]
  /** Its committer time, in seconds. */
  t: number
  author: string
  subject: string
}

export class CommitGraph {
  readonly commits = new Map<string, GraphCommit>()
  private reach = new Map<string, Set<string>>()
  private kids: Map<string, string[]> | null = null

  /** From the lines `git log --format=%H%x09%P%x09%ct%x09%an%x09%s` printed. */
  constructor(text: string) {
    for (const line of text.split("\n")) {
      if (!line) continue
      const [h = "", parents = "", t = "0", author = "", ...subject] = line.split("\t")
      if (h) this.commits.set(h, { parents: parents.split(" ").filter(Boolean), t: Number(t), author, subject: subject.join("\t") })
    }
  }

  has(h: string): boolean {
    return this.commits.has(h)
  }

  /** `h` and every commit of the graph it descends from. */
  ancestors(h: string): Set<string> {
    const known = this.reach.get(h)
    if (known) return known
    const seen = new Set<string>()
    const stack = [h]
    while (stack.length) {
      const c = stack.pop()!
      const node = this.commits.get(c)
      if (!node || seen.has(c)) continue
      seen.add(c)
      for (const p of node.parents) stack.push(p)
    }
    this.reach.set(h, seen)
    return seen
  }

  /** Each commit's children in the graph, built once. */
  private children(): Map<string, string[]> {
    if (!this.kids) {
      this.kids = new Map()
      for (const [c, node] of this.commits) for (const p of node.parents) (this.kids.get(p) ?? this.kids.set(p, []).get(p)!).push(c)
    }
    return this.kids
  }

  /** Every commit of the graph that has `h` among its ancestors, `h` itself excluded. */
  descendants(h: string): Set<string> {
    const kids = this.children()
    const seen = new Set<string>()
    const stack = [...(kids.get(h) ?? [])]
    while (stack.length) {
      const c = stack.pop()!
      if (seen.has(c)) continue
      seen.add(c)
      for (const k of kids.get(c) ?? []) stack.push(k)
    }
    return seen
  }

  /** The parents, outside the graph, of the commits in `inside`: where those commits leave it, each once. */
  leaving(inside: Iterable<string>): string[] {
    const out = new Set<string>()
    for (const c of inside) for (const p of this.commits.get(c)?.parents ?? []) if (!this.commits.has(p)) out.add(p)
    return [...out]
  }

  /** The newest commits of `set`: those with no child in it. */
  newest(set: ReadonlySet<string>): string[] {
    const out: string[] = []
    for (const c of set) {
      let hasChild = false
      for (const k of this.childrenOf(c)) {
        if (set.has(k)) {
          hasChild = true
          break
        }
      }
      if (!hasChild) out.push(c)
    }
    return out
  }

  private childrenOf(h: string): string[] {
    return this.children().get(h) ?? []
  }

  /**
   * The first-parent commits from `from` down, at most `n`, stopping before the first one for which `stop` holds, or one
   * outside the graph. `end` says which ended it: a commit outside the graph, one that `stop` holds for, or none (the
   * root, or `n` reached).
   */
  firstParents(from: string, stop: (c: string) => boolean, n: number): { list: string[]; end: "outside" | "stopped" | null } {
    const list: string[] = []
    let c: string | undefined = from
    while (c !== undefined && list.length < n) {
      if (!this.commits.has(c)) return { list, end: "outside" }
      if (stop(c)) return { list, end: "stopped" }
      list.push(c)
      c = this.commits.get(c)!.parents[0]
    }
    return { list, end: null }
  }
}
