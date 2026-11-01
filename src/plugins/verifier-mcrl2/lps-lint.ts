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
//
// The print is read in chunks and never held whole: `lpspp` prints every shared
// subterm in full, so a 1.8 MB LPS can print as 806 MB, past the longest string
// JavaScript holds. A condition is counted only up to the limit: past it, the
// scanner stops counting and only follows the brackets to the condition's end,
// so its size is then a lower bound, `limit + 1`, marked `atLeast`.

import { closeSync, openSync, readSync } from "node:fs"

/** One summand's condition: its place among the summands (from 0) and its size in operator and variable occurrences; `atLeast` when counting stopped past the limit. */
export interface ConditionSize {
  summand: number
  size: number
  atLeast?: true
}

const SUMMAND = "LinearProcessSummand"
const COUNTED: ReadonlySet<string> = new Set(["OpId", "DataVarId"])

interface Frame {
  symbol: string
  arg: number
  /** The summand this frame is the condition of, when it is one. */
  condition?: number
}

/**
 * A scanner of the internal ATerm text of an LPS, fed in chunks of any size (a quoted name or a symbol may be split
 * across two). `cap`: a condition past it stops being counted, and its size is `cap + 1`, marked `atLeast`.
 */
export class ConditionScanner {
  readonly sizes: ConditionSize[] = []
  private readonly stack: Frame[] = []
  /** The summand whose condition is being read, by its place in `sizes`; -1 outside every condition. */
  private inCondition = -1
  private symbol = ""
  private quoted = false
  private escaped = false

  private readonly cap: number

  constructor(cap: number = Infinity) {
    this.cap = cap
  }

  private enterArgument(): void {
    const top = this.stack[this.stack.length - 1]
    if (top && top.symbol === SUMMAND && top.arg === 1) {
      this.sizes.push({ summand: this.sizes.length, size: 0 })
      this.inCondition = this.sizes.length - 1
      top.condition = this.inCondition
    }
  }

  private leaveArgument(): void {
    const top = this.stack[this.stack.length - 1]
    if (top && top.condition !== undefined) {
      this.inCondition = -1
      delete top.condition
    }
  }

  /** The condition being read is past the cap: its symbols are no longer collected. */
  private skipping(): boolean {
    return this.inCondition >= 0 && this.sizes[this.inCondition]!.atLeast === true
  }

  feed(text: string): void {
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!
      if (this.quoted) {
        // A quoted name: everything up to the closing quote, a backslash escaping the next character.
        if (this.escaped) this.escaped = false
        else if (c === "\\") this.escaped = true
        else if (c === '"') {
          this.quoted = false
          this.symbol = "quoted"
        }
        continue
      }
      if (c === '"') {
        this.quoted = true
        continue
      }
      if (c === "(" || c === "[") {
        if (c === "(" && this.inCondition >= 0 && COUNTED.has(this.symbol)) {
          const size = this.sizes[this.inCondition]!
          if (!size.atLeast && ++size.size > this.cap) size.atLeast = true
        }
        this.stack.push({ symbol: c === "(" ? this.symbol : "[", arg: 0 })
        this.symbol = ""
        this.enterArgument()
        continue
      }
      if (c === ",") {
        this.leaveArgument()
        const top = this.stack[this.stack.length - 1]
        if (top) top.arg++
        this.symbol = ""
        this.enterArgument()
        continue
      }
      if (c === ")" || c === "]") {
        this.leaveArgument()
        this.stack.pop()
        this.symbol = ""
        continue
      }
      if (c === " " || c === "\n" || c === "\r" || c === "\t") continue
      // Only the symbols of a summand's own structure, and of a condition still under the cap, are needed.
      if (!this.skipping()) this.symbol += c
    }
  }
}

/** The size of each summand's condition in the internal ATerm text of an LPS, in the order of the summands, each counted up to `cap`. */
export function conditionSizes(aterm: string, cap: number = Infinity): ConditionSize[] {
  const scanner = new ConditionScanner(cap)
  scanner.feed(aterm)
  return scanner.sizes
}

/** The bytes read at a time from the print. */
const CHUNK = 1 << 20

/** The size of each summand's condition in the file at `path`, read in chunks and never held whole, each counted up to `cap`. */
export function conditionSizesOfFile(path: string, cap: number = Infinity, chunk: number = CHUNK): ConditionSize[] {
  const scanner = new ConditionScanner(cap)
  const decoder = new TextDecoder("utf-8")
  const buffer = new Uint8Array(chunk)
  const fd = openSync(path, "r")
  try {
    for (;;) {
      const n = readSync(fd, buffer, 0, chunk, null)
      if (n === 0) break
      scanner.feed(decoder.decode(buffer.subarray(0, n), { stream: true }))
    }
    scanner.feed(decoder.decode())
  } finally {
    closeSync(fd)
  }
  return scanner.sizes
}

/** What the lint found: the limit, the largest condition, how many summands are over the limit, and the largest of them (at most `SHOWN`), the largest first; `largestAtLeast` when the largest is a lower bound. */
export interface ConditionLint {
  limit: number
  summands: number
  largest: number
  largestAtLeast?: true
  overCount: number
  over: ConditionSize[]
}

/** The most summands over the limit a lint keeps by name. */
export const SHOWN = 20

/** The lint of conditions already measured against `limit` (operator and variable occurrences). */
export function lintSizes(sizes: readonly ConditionSize[], limit: number): ConditionLint {
  const over = sizes.filter((s) => s.size > limit).sort((a, b) => b.size - a.size || a.summand - b.summand)
  const largest = sizes.reduce((m, s) => Math.max(m, s.size), 0)
  return {
    limit,
    summands: sizes.length,
    largest,
    ...(sizes.some((s) => s.atLeast && s.size === largest) ? { largestAtLeast: true as const } : {}),
    overCount: over.length,
    over: over.slice(0, SHOWN),
  }
}

/** The lint of an LPS's conditions against `limit` (operator and variable occurrences), each counted up to the limit. */
export function lintConditions(aterm: string, limit: number): ConditionLint {
  return lintSizes(conditionSizes(aterm, limit), limit)
}

/** The lint of the LPS printed in the file at `path`, read as a stream, each condition counted up to the limit. */
export function lintConditionsOfFile(path: string, limit: number): ConditionLint {
  return lintSizes(conditionSizesOfFile(path, limit), limit)
}

/** A size as said to a person: `more than <limit>` when counting stopped there. */
export function sizeText(size: number, atLeast: boolean | undefined, limit: number): string {
  return atLeast ? `more than ${limit}` : String(size)
}

/** The lint in one line of a run's output; null when no summand is over the limit. */
export function lintLine(lint: ConditionLint): string | null {
  if (!lint.overCount) return null
  const shown = lint.over.slice(0, 5).map((s) => `summand ${s.summand}: ${sizeText(s.size, s.atLeast, lint.limit)}`).join(", ")
  return `lint: ${lint.overCount} of ${lint.summands} summands have a condition larger than ${lint.limit} operator and variable occurrences (${shown}${
    lint.overCount > 5 ? ", …" : ""
  }): a guard copied into every summand makes each tool slower; share it as one derived predicate (see the verifier guide on model size)`
}
