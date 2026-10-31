// The lint on summand conditions: how large each summand's condition is in a
// linear process, read from the LPS as `lpspp --format=internal` prints it, a
// textual ATerm. A condition many times larger than the rest is the mark of a
// guard copied into every summand, which slows every tool that reads the LPS.
//
// The ATerm text is read by a scanner that follows its structure: function
// applications `f(a, …)`, lists `[a, …]`, quoted names `"…"` with escapes. The
// size of a condition is the number of operator and variable occurrences in it
// (`OpId` and `DataVarId` terms): what the model's author wrote and the
// linearisation expanded, independent of how the sorts are spelled.

/** One summand's condition: its place among the summands (from 0) and its size in operator and variable occurrences. */
export interface ConditionSize {
  summand: number
  size: number
}

const SUMMAND = "LinearProcessSummand"
const COUNTED: ReadonlySet<string> = new Set(["OpId", "DataVarId"])

interface Frame {
  symbol: string
  arg: number
  /** The summand this frame is the condition of, when it is one. */
  condition?: number
}

/** The size of each summand's condition in the internal ATerm text of an LPS, in the order of the summands. */
export function conditionSizes(aterm: string): ConditionSize[] {
  const out: ConditionSize[] = []
  const stack: Frame[] = []
  /** The summand whose condition is being read, by its place in `out`; -1 outside every condition. */
  let inCondition = -1
  let symbol = ""
  const enterArgument = (): void => {
    const top = stack[stack.length - 1]
    if (top && top.symbol === SUMMAND && top.arg === 1) {
      out.push({ summand: out.length, size: 0 })
      inCondition = out.length - 1
      top.condition = inCondition
    }
  }
  const leaveArgument = (): void => {
    const top = stack[stack.length - 1]
    if (top && top.condition !== undefined) {
      inCondition = -1
      delete top.condition
    }
  }
  for (let i = 0; i < aterm.length; i++) {
    const c = aterm[i]!
    if (c === '"') {
      // A quoted name: everything up to the closing quote, a backslash escaping the next character.
      for (i++; i < aterm.length && aterm[i] !== '"'; i++) if (aterm[i] === "\\") i++
      symbol = "quoted"
      continue
    }
    if (c === "(" || c === "[") {
      if (c === "(" && inCondition >= 0 && COUNTED.has(symbol)) out[inCondition]!.size++
      stack.push({ symbol: c === "(" ? symbol : "[", arg: 0 })
      symbol = ""
      enterArgument()
      continue
    }
    if (c === ",") {
      leaveArgument()
      const top = stack[stack.length - 1]
      if (top) top.arg++
      symbol = ""
      enterArgument()
      continue
    }
    if (c === ")" || c === "]") {
      leaveArgument()
      stack.pop()
      symbol = ""
      continue
    }
    if (c === " " || c === "\n" || c === "\r" || c === "\t") continue
    symbol += c
  }
  return out
}

/** What the lint found: the limit, the largest condition, how many summands are over the limit, and the largest of them (at most `SHOWN`), the largest first. */
export interface ConditionLint {
  limit: number
  summands: number
  largest: number
  overCount: number
  over: ConditionSize[]
}

/** The most summands over the limit a lint keeps by name. */
export const SHOWN = 20

/** The lint of an LPS's conditions against `limit` (operator and variable occurrences). */
export function lintConditions(aterm: string, limit: number): ConditionLint {
  const sizes = conditionSizes(aterm)
  const over = sizes.filter((s) => s.size > limit).sort((a, b) => b.size - a.size || a.summand - b.summand)
  return { limit, summands: sizes.length, largest: sizes.reduce((m, s) => Math.max(m, s.size), 0), overCount: over.length, over: over.slice(0, SHOWN) }
}

/** The lint in one line of a run's output; null when no summand is over the limit. */
export function lintLine(lint: ConditionLint): string | null {
  if (!lint.overCount) return null
  const shown = lint.over.slice(0, 5).map((s) => `summand ${s.summand}: ${s.size}`).join(", ")
  return `lint: ${lint.overCount} of ${lint.summands} summands have a condition larger than ${lint.limit} operator and variable occurrences (${shown}${
    lint.overCount > 5 ? ", …" : ""
  }): a guard copied into every summand makes each tool slower; share it as one derived predicate (see the verifier guide on model size)`
}
