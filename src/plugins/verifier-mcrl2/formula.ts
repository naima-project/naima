// The LTS route's soundness check (specs/verifier-mcrl2-lts-route-cross-check,
// §3): a parser for the part of mCRL2's modal formula syntax the check
// accepts, the fragment the reduction modulo divergence-preserving branching
// bisimilarity preserves, the actions a formula mentions, and the action names
// of an LTS label.
//
// The parser reads state formulas, regular formulas and action formulas by
// recursive descent, with mCRL2's precedences: `=>` (right-associative) below
// `||` below `&&` below the prefixes `!`, `[R]`, `<R>`; quantifiers and
// fixpoints extend as far right as they can; in regular formulas `+` (choice)
// below `.` below the postfix `*` and `+`. Data — action arguments, sorts,
// `val(…)` — is skipped, never interpreted. Anything the check does not accept
// is a refusal that quotes the text it stopped at.

/** An action formula. */
export type ActFrm =
  | { k: "true" | "false" | "val"; at: Span }
  | { k: "act"; name: string; at: Span }
  | { k: "not"; a: ActFrm; at: Span }
  | { k: "and" | "or" | "imp"; l: ActFrm; r: ActFrm; at: Span }
  | { k: "quant"; body: ActFrm; at: Span }

/** A regular formula. */
export type RegFrm =
  | { k: "act"; a: ActFrm; at: Span }
  | { k: "nil"; at: Span }
  | { k: "seq" | "alt"; l: RegFrm; r: RegFrm; at: Span }
  | { k: "star" | "plus"; r: RegFrm; at: Span }

/** A state formula. */
export type StateFrm =
  | { k: "true" | "false" | "val"; at: Span }
  | { k: "not"; f: StateFrm; at: Span }
  | { k: "and" | "or" | "imp"; l: StateFrm; r: StateFrm; at: Span }
  | { k: "quant"; body: StateFrm; at: Span }
  | { k: "box" | "dia"; r: RegFrm; f: StateFrm; at: Span }
  | { k: "mu" | "nu"; x: string; f: StateFrm; at: Span }
  | { k: "var"; x: string; at: Span }

/** Where a node is in the source: start and end offsets. */
export interface Span {
  from: number
  to: number
}

/**
 * The check's answer: in the fragment, with the actions the formula mentions and whether it sees divergence (an
 * inevitability pattern, or deadlock through a star), which plain branching bisimilarity does not preserve; or
 * refused, saying why.
 */
export type FragmentAnswer = { ok: true; mentioned: string[]; divergence: boolean } | { ok: false; reason: string }

interface Token {
  text: string
  kind: "id" | "num" | "sym" | "end"
  from: number
  to: number
}

const SYMBOLS = [
  "&&",
  "||",
  "=>",
  "->",
  "==",
  "!=",
  "<=",
  ">=",
  "++",
  "|>",
  "<|",
  "[",
  "]",
  "(",
  ")",
  "{",
  "}",
  "<",
  ">",
  ".",
  ",",
  ":",
  "!",
  "*",
  "+",
  "|",
  "@",
  "#",
  "=",
  "-",
  "/",
  "?",
  ";",
]

class Refusal extends Error {}

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === "%") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    const id = /^[A-Za-z_][A-Za-z0-9_']*/.exec(src.slice(i))
    if (id) {
      out.push({ text: id[0], kind: "id", from: i, to: i + id[0].length })
      i += id[0].length
      continue
    }
    const num = /^[0-9]+/.exec(src.slice(i))
    if (num) {
      out.push({ text: num[0], kind: "num", from: i, to: i + num[0].length })
      i += num[0].length
      continue
    }
    const sym = SYMBOLS.find((s) => src.startsWith(s, i)) ?? c
    out.push({ text: sym, kind: "sym", from: i, to: i + sym.length })
    i += sym.length
  }
  out.push({ text: "", kind: "end", from: src.length, to: src.length })
  return out
}

const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}" }

/** The parser of one formula's source. */
class Parser {
  private readonly src: string
  private readonly t: Token[]
  private i = 0
  constructor(src: string) {
    this.src = src
    this.t = tokenize(src)
  }

  private get peek(): Token {
    return this.t[this.i]!
  }
  private next(): Token {
    return this.t[this.i++]!
  }
  private is(text: string): boolean {
    return this.peek.kind !== "end" && this.peek.text === text
  }
  private eat(text: string): boolean {
    if (!this.is(text)) return false
    this.i++
    return true
  }
  private expect(text: string): Token {
    if (!this.is(text)) this.fail(`expected ${JSON.stringify(text)}`)
    return this.next()
  }
  private span(from: number): Span {
    return { from, to: this.t[this.i - 1]?.to ?? from }
  }
  fail(why: string): never {
    const tok = this.peek
    const where = tok.kind === "end" ? "at the end of the formula" : `at ${JSON.stringify(this.src.slice(tok.from, tok.from + 24))}`
    throw new Refusal(`${why} ${where}`)
  }

  /** Skip a bracketed data expression starting at an opening bracket, to its matching closing one. */
  private skipBracketed(): void {
    const stack: string[] = []
    do {
      const tok = this.next()
      if (tok.kind === "end") this.fail("an unclosed bracket")
      if (OPEN[tok.text]) stack.push(OPEN[tok.text]!)
      else if (tok.text === stack[stack.length - 1]) stack.pop()
      else if (tok.text === ")" || tok.text === "]" || tok.text === "}") this.fail("a mismatched bracket")
    } while (stack.length)
  }

  /** `v1, v2: S1, v3: S2 .` — the declarations of a quantifier, up to and including its dot. */
  private declarations(): void {
    for (;;) {
      do {
        if (this.next().kind !== "id") this.fail("a variable name expected in a quantifier")
      } while (this.eat(","))
      this.expect(":")
      let tokens = 0
      while (!this.is(",") && !this.is(".")) {
        if (this.peek.kind === "end") this.fail("a sort that does not end")
        if (OPEN[this.peek.text]) this.skipBracketed()
        else this.next()
        tokens++
      }
      if (!tokens) this.fail("a sort expected")
      if (this.eat(".")) return
      this.expect(",")
    }
  }

  // State formulas.

  state(): StateFrm {
    const from = this.peek.from
    const l = this.stateOr()
    if (this.eat("=>")) return { k: "imp", l, r: this.state(), at: this.span(from) }
    return l
  }
  private stateOr(): StateFrm {
    const from = this.peek.from
    let l = this.stateAnd()
    while (this.eat("||")) l = { k: "or", l, r: this.stateAnd(), at: this.span(from) }
    return l
  }
  private stateAnd(): StateFrm {
    const from = this.peek.from
    let l = this.stateUnary()
    while (this.eat("&&")) l = { k: "and", l, r: this.stateUnary(), at: this.span(from) }
    return l
  }
  private stateUnary(): StateFrm {
    const from = this.peek.from
    if (this.eat("!")) return { k: "not", f: this.stateUnary(), at: this.span(from) }
    if (this.eat("[")) {
      const r = this.reg()
      this.expect("]")
      return { k: "box", r, f: this.stateUnary(), at: this.span(from) }
    }
    if (this.eat("<")) {
      const r = this.reg()
      this.expect(">")
      return { k: "dia", r, f: this.stateUnary(), at: this.span(from) }
    }
    if (this.eat("forall") || this.eat("exists")) {
      this.declarations()
      return { k: "quant", body: this.state(), at: this.span(from) }
    }
    if (this.is("mu") || this.is("nu")) {
      const k = this.next().text as "mu" | "nu"
      const x = this.next()
      if (x.kind !== "id") this.fail("a fixpoint variable expected")
      if (this.is("(")) this.fail("a parameterised fixpoint, which the check does not accept,")
      this.expect(".")
      return { k, x: x.text, f: this.state(), at: this.span(from) }
    }
    return this.statePrimary()
  }
  private statePrimary(): StateFrm {
    const from = this.peek.from
    if (this.eat("true")) return { k: "true", at: this.span(from) }
    if (this.eat("false")) return { k: "false", at: this.span(from) }
    if (this.is("val")) {
      this.next()
      if (!this.is("(")) this.fail("val without its argument")
      this.skipBracketed()
      return { k: "val", at: this.span(from) }
    }
    if (this.eat("(")) {
      const f = this.state()
      this.expect(")")
      return { ...f, at: this.span(from) }
    }
    if (this.is("delay") || this.is("yaled")) this.fail("a time operator, which the check does not accept,")
    if (this.peek.kind === "id") {
      const x = this.next().text
      if (this.is("(")) this.fail("a parameterised fixpoint variable, which the check does not accept,")
      return { k: "var", x, at: this.span(from) }
    }
    this.fail("a state formula expected")
  }

  // Regular formulas.

  private reg(): RegFrm {
    const from = this.peek.from
    let l = this.regSeq()
    while (this.eat("+")) l = { k: "alt", l, r: this.regSeq(), at: this.span(from) }
    return l
  }
  private regSeq(): RegFrm {
    const from = this.peek.from
    let l = this.regPost()
    while (this.eat(".")) l = { k: "seq", l, r: this.regPost(), at: this.span(from) }
    return l
  }
  /** A `+` is postfix when what follows it cannot start a regular formula. */
  private postfixPlus(): boolean {
    const after = this.t[this.i + 1]!
    return this.is("+") && (after.kind === "end" || [".", "]", ">", ")", "*", "+"].includes(after.text))
  }
  private regPost(): RegFrm {
    const from = this.peek.from
    let r = this.regPrimary()
    for (;;) {
      if (this.eat("*")) r = { k: "star", r, at: this.span(from) }
      else if (this.postfixPlus()) {
        this.next()
        r = { k: "plus", r, at: this.span(from) }
      } else return r
    }
  }
  private regPrimary(): RegFrm {
    const from = this.peek.from
    if (this.eat("nil")) return { k: "nil", at: this.span(from) }
    // A parenthesis opens an action formula or a regular one: the action formula is tried first.
    const mark = this.i
    try {
      const a = this.act()
      return { k: "act", a, at: this.span(from) }
    } catch (e) {
      if (!(e instanceof Refusal) || !this.t[mark] || this.t[mark]!.text !== "(") throw e
      this.i = mark + 1
      const r = this.reg()
      this.expect(")")
      return { ...r, at: this.span(from) }
    }
  }

  // Action formulas.

  private act(): ActFrm {
    const from = this.peek.from
    const l = this.actOr()
    if (this.eat("=>")) return { k: "imp", l, r: this.act(), at: this.span(from) }
    return l
  }
  private actOr(): ActFrm {
    const from = this.peek.from
    let l = this.actAnd()
    while (this.eat("||")) l = { k: "or", l, r: this.actAnd(), at: this.span(from) }
    return l
  }
  private actAnd(): ActFrm {
    const from = this.peek.from
    let l = this.actUnary()
    while (this.eat("&&")) l = { k: "and", l, r: this.actUnary(), at: this.span(from) }
    return l
  }
  private actUnary(): ActFrm {
    const from = this.peek.from
    if (this.eat("!")) return { k: "not", a: this.actUnary(), at: this.span(from) }
    if (this.eat("forall") || this.eat("exists")) {
      this.declarations()
      return { k: "quant", body: this.act(), at: this.span(from) }
    }
    return this.actPrimary()
  }
  private actPrimary(): ActFrm {
    const from = this.peek.from
    if (this.eat("true")) return { k: "true", at: this.span(from) }
    if (this.eat("false")) return { k: "false", at: this.span(from) }
    if (this.eat("(")) {
      const a = this.act()
      this.expect(")")
      return { ...a, at: this.span(from) }
    }
    if (this.is("tau")) this.fail("tau in an action formula, which the check does not accept,")
    if (this.is("val")) {
      this.next()
      if (!this.is("(")) this.fail("val without its argument")
      this.skipBracketed()
      return { k: "val", at: this.span(from) }
    }
    if (this.peek.kind !== "id") this.fail("an action formula expected")
    const name = this.next().text
    if (this.is("(")) this.skipBracketed()
    if (this.is("|")) this.fail("a multi-action, which the check does not accept,")
    if (this.is("@")) this.fail("a timed action, which the check does not accept,")
    return { k: "act", name, at: this.span(from) }
  }

  /** The whole source as one state formula. */
  formula(): StateFrm {
    const f = this.state()
    if (this.peek.kind !== "end") this.fail("text after the formula")
    return f
  }
}

/** Parse a formula, or throw a refusal saying where the check stopped. */
export function parseFormula(src: string): StateFrm {
  return new Parser(src).formula()
}

/**
 * Whether an action formula is true of the internal action τ, decided by its syntax: `val(…)` does not depend on the
 * action, so it is unknown here, and the connectives are Kleene's three-valued ones; undefined when it cannot be decided.
 */
export function includesTau(a: ActFrm): boolean | undefined {
  switch (a.k) {
    case "true":
      return true
    case "false":
    case "act":
      return false
    case "val":
      return undefined
    case "not": {
      const v = includesTau(a.a)
      return v === undefined ? undefined : !v
    }
    case "and": {
      const l = includesTau(a.l)
      const r = includesTau(a.r)
      return l === false || r === false ? false : l && r ? true : undefined
    }
    case "or": {
      const l = includesTau(a.l)
      const r = includesTau(a.r)
      return l === true || r === true ? true : l === false && r === false ? false : undefined
    }
    case "imp":
      return includesTau({ k: "or", l: { k: "not", a: a.l, at: a.at }, r: a.r, at: a.at })
    case "quant":
      return includesTau(a.body)
  }
}

/** Whether an action formula includes τ; refused when its syntax cannot decide it. */
function tauIn(a: ActFrm): boolean {
  const v = includesTau(a)
  if (v === undefined) throw new Outside(a.at, "an action formula whose val(…) leaves undecided whether it includes τ")
  return v
}

/** The names of the actions a formula mentions, sorted. */
export function mentionedActions(f: StateFrm): string[] {
  const out = new Set<string>()
  const act = (a: ActFrm): void => {
    if (a.k === "act") out.add(a.name)
    else if (a.k === "not") act(a.a)
    else if (a.k === "and" || a.k === "or" || a.k === "imp") (act(a.l), act(a.r))
    else if (a.k === "quant") act(a.body)
  }
  const reg = (r: RegFrm): void => {
    if (r.k === "act") act(r.a)
    else if (r.k === "seq" || r.k === "alt") (reg(r.l), reg(r.r))
    else if (r.k === "star" || r.k === "plus") reg(r.r)
  }
  const state = (s: StateFrm): void => {
    if (s.k === "not") state(s.f)
    else if (s.k === "and" || s.k === "or" || s.k === "imp") (state(s.l), state(s.r))
    else if (s.k === "quant") state(s.body)
    else if (s.k === "box" || s.k === "dia") (reg(s.r), state(s.f))
    else if (s.k === "mu" || s.k === "nu") state(s.f)
  }
  state(f)
  return [...out].sort()
}

/** Where the check found a form outside the fragment. */
class Outside extends Error {
  readonly at: Span
  constructor(at: Span, why: string) {
    super(why)
    this.at = at
  }
}

const isTrueStep = (r: RegFrm): boolean => r.k === "act" && r.a.k === "true"
const tauStep = (r: RegFrm): r is { k: "act"; a: ActFrm; at: Span } => r.k === "act" && tauIn(r.a)

/** A weak path (§3.1): every visible step right after a τ-closed star; whether it ends in one. */
function weakPath(r: RegFrm, afterStar: boolean): boolean {
  switch (r.k) {
    case "act":
      if (tauIn(r.a)) throw new Outside(r.at, "a single step that includes τ: it counts internal steps")
      if (!afterStar) throw new Outside(r.at, "a visible step not right after a τ-closed star: it skips no internal step before it")
      return false
    case "nil":
      return afterStar
    case "seq":
      return weakPath(r.r, weakPath(r.l, afterStar))
    case "alt": {
      const l = weakPath(r.l, afterStar)
      const rr = weakPath(r.r, afterStar)
      return l && rr
    }
    case "star":
      if (!tauStep(r.r)) throw new Outside(r.at, "a star of something other than an action formula that includes τ")
      return true
    case "plus":
      throw new Outside(r.at, "R+, which requires at least one step")
  }
}

/** `<true>true` under a box, `[true]false` under a diamond: deadlock freedom, or a deadlock, reached through a τ-closed star. */
const deadlockBody = (kind: "box" | "dia", f: StateFrm): boolean =>
  kind === "box" ? f.k === "dia" && isTrueStep(f.r) && f.f.k === "true" : f.k === "box" && isTrueStep(f.r) && f.f.k === "false"

const isVar = (f: StateFrm, x: string): boolean => f.k === "var" && f.x === x

/** One of the four inevitability patterns (§3.1). */
function inevitability(f: StateFrm & { k: "mu" | "nu" }): boolean {
  const { x, f: body } = f
  const [step, end, join] = f.k === "mu" ? (["box", "dia", "and"] as const) : (["dia", "box", "or"] as const)
  const loop = (g: StateFrm): boolean => g.k === step && tauStep(g.r) && isVar(g.f, x)
  const stop = (g: StateFrm): boolean => g.k === end && isTrueStep(g.r) && g.f.k === (f.k === "mu" ? "true" : "false")
  if (loop(body)) return true
  return body.k === join && ((loop(body.l) && stop(body.r)) || (stop(body.l) && loop(body.r)))
}

/** Whether a formula in the fragment uses a form that sees divergence: set by `inFragment` as it goes. */
interface Seen {
  divergence: boolean
}

function inFragment(f: StateFrm, seen: Seen): void {
  switch (f.k) {
    case "true":
    case "false":
    case "val":
      return
    case "not":
      return inFragment(f.f, seen)
    case "and":
    case "or":
    case "imp":
      inFragment(f.l, seen)
      return inFragment(f.r, seen)
    case "quant":
      return inFragment(f.body, seen)
    case "box":
    case "dia": {
      // Nested modalities of one kind are joined: [R1][R2]φ is [R1 . R2]φ.
      let r = f.r
      let body = f.f
      while (body.k === f.k) {
        r = { k: "seq", l: r, r: body.r, at: { from: r.at.from, to: body.r.at.to } }
        body = body.f
      }
      const endsStar = weakPath(r, false)
      if (endsStar && deadlockBody(f.k, body)) {
        seen.divergence = true
        return
      }
      return inFragment(body, seen)
    }
    case "mu":
    case "nu":
      if (!inevitability(f)) throw new Outside(f.at, "a fixpoint other than the four inevitability patterns")
      seen.divergence = true
      return
    case "var":
      throw new Outside(f.at, `the fixpoint variable ${f.x} outside its pattern`)
  }
}

const quote = (src: string, at: Span): string => {
  const text = src.slice(at.from, at.to).replace(/\s+/g, " ").trim()
  return JSON.stringify(text.length > 120 ? text.slice(0, 117) + "..." : text)
}

/** Whether the formula `src` is in the fragment the LTS route preserves (§3.1), and the actions it mentions (§3.2). */
export function checkFragment(src: string): FragmentAnswer {
  let f: StateFrm
  try {
    f = parseFormula(src)
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, reason: `the check cannot read the formula: ${e.message}` }
    throw e
  }
  const seen: Seen = { divergence: false }
  try {
    inFragment(f, seen)
  } catch (e) {
    if (e instanceof Outside) return { ok: false, reason: `${quote(src, e.at)} is ${e.message}` }
    throw e
  }
  return { ok: true, mentioned: mentionedActions(f), divergence: seen.divergence }
}

/** The action names of one LTS label, `tau` giving none (§3.3); null when the label cannot be read. */
export function labelActions(label: string): string[] | null {
  const text = label.trim()
  if (text === "tau") return []
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c === "(" || c === "[" || c === "{") depth++
    else if (c === ")" || c === "]" || c === "}") depth--
    else if (c === "|" && depth === 0 && text[i + 1] !== "|" && text[i - 1] !== "|") {
      parts.push(text.slice(start, i))
      start = i + 1
    }
    if (depth < 0) return null
  }
  if (depth !== 0) return null
  parts.push(text.slice(start))
  const names = parts.map((p) => /^\s*([A-Za-z_][A-Za-z0-9_']*)\s*(\(|$)/.exec(p)?.[1])
  return names.every((n) => n !== undefined) ? (names as string[]) : null
}
