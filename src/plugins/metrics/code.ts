// Code-quality measures, taken in process: no program to start, no dependency.
//
// A measure reads the project's files — the working tree, or a past commit
// straight from git's objects — and returns one number: lines of code, files,
// functions, function size, cyclomatic complexity, duplication, TODO markers,
// dependencies. How a file's comments are told from its code, and how its
// functions are found, is its language: a contribution to the
// `code-languages` point. TypeScript and JavaScript come with a small
// function finder and complexity estimator; any plugin may add another
// language's.
//
// The estimator is a token scan, not a parser: it finds function
// declarations and expressions, arrow functions and methods, skips strings,
// comments, regular expressions and type annotations, and counts the
// decisions in each body — if, for, while, case, catch, &&, ||, ?? and the
// ternary — plus one. Good enough to see a trend; not a type checker.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { pathMatches } from "../../core/api.ts"

/** A function a language found in a file. */
export interface FunctionInfo {
  name: string
  /** The 1-based line it starts on. */
  line: number
  /** How many lines it spans, its signature's first to its body's last. */
  lines: number
  /** Cyclomatic complexity: one plus the decisions in its own body, nested functions apart. */
  complexity: number
}

/** A language: which files are its, how its comments read, and — when it can — its functions. */
export interface Language {
  id: string
  says: string
  /** File extensions, with the dot: ".ts". */
  extensions: string[]
  /** True for a programming language: what code measures count by default. Markup and data are false. */
  code: boolean
  /** Comment syntax: line prefixes and block delimiters, for telling code lines from comments. */
  comments?: { line?: string[]; block?: [string, string][] }
  /** Quote characters strings open with; a backtick also spans lines. Default: " and '. */
  quotes?: string[]
  /** True when `/…/` after an operator is a regular expression, as in JavaScript: its quotes and slashes are not strings or comments. */
  regex?: boolean
  /** The functions in a file's text, comments already blanked. Without it, function measures skip the language. */
  functions?(stripped: string): FunctionInfo[]
}

const C_LIKE = { line: ["//"], block: [["/*", "*/"]] as [string, string][] }
const HASH = { line: ["#"] }

/** Blank a file's comments, keeping every newline and every string: what is left on a line is its code. */
export function stripComments(text: string, lang: Pick<Language, "comments" | "quotes" | "regex">): string {
  const lineStarts = lang.comments?.line ?? []
  const blocks = lang.comments?.block ?? []
  const quotes = lang.quotes ?? ['"', "'"]
  const out: string[] = []
  let i = 0
  const n = text.length
  const blank = (s: string) => s.replace(/[^\n]/g, " ")
  // The last character that was code, and the word before it: whether a slash opens a regular expression.
  let last = ""
  let word = ""
  while (i < n) {
    const c = text[i] as string
    if (
      lang.regex && c === "/" && text[i + 1] !== "/" && text[i + 1] !== "*" && (last === "" || "(,=:[!&|?{};+-*%<>~^".includes(last) || REGEX_WORDS.has(word))
    ) {
      let j = i + 1
      let cls = false
      while (j < n && text[j] !== "\n") {
        const d = text[j]
        if (d === "\\") j++
        else if (d === "[") cls = true
        else if (d === "]") cls = false
        else if (d === "/" && !cls) break
        j++
      }
      out.push(text.slice(i, j + 1))
      i = j + 1
      last = "/"
      word = ""
      continue
    }
    if (!/\s/.test(c)) {
      if (/[\w$]/.test(c)) word = /[\w$]/.test(last) ? word + c : c
      else word = ""
      last = c
    }
    if (quotes.includes(c)) {
      let j = i + 1
      while (j < n && text[j] !== c) {
        if (text[j] === "\\") j++
        else if (text[j] === "\n" && c !== "`") break
        j++
      }
      out.push(text.slice(i, j + 1))
      i = j + 1
      continue
    }
    const block = blocks.find(([open]) => text.startsWith(open, i))
    if (block) {
      const end = text.indexOf(block[1], i + block[0].length)
      const stop = end < 0 ? n : end + block[1].length
      out.push(blank(text.slice(i, stop)))
      i = stop
      continue
    }
    if (lineStarts.some((p) => text.startsWith(p, i))) {
      const end = text.indexOf("\n", i)
      const stop = end < 0 ? n : end
      out.push(blank(text.slice(i, stop)))
      i = stop
      continue
    }
    out.push(c)
    i++
  }
  return out.join("")
}

const REGEX_WORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await"])

/** How many lines of a stripped text have code on them. */
export const codeLineCount = (stripped: string): number => stripped.split("\n").filter((l) => l.trim() !== "").length

// ---- TypeScript and JavaScript -------------------------------------------------

interface Token {
  t: string
  line: number
  /** True when a newline separates it from the token before. */
  nl: boolean
}

const PUNCT3 = ["&&=", "||=", "??=", "...", "===", "!==", "**=", "<<=", ">>="]
const PUNCT2 = ["=>", "&&", "||", "??", "?.", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "++", "--", "**", "<<", ">>"]
const REGEX_AFTER = new Set([
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "~",
  "^",
  "=>",
  "&&",
  "||",
  "??",
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "instanceof",
  "yield",
  "await",
])

/** The tokens of a JS/TS text whose comments are blanked: strings, templates and regular expressions become one token each. */
export function tokenize(src: string): Token[] {
  const out: Token[] = []
  let line = 1
  let nl = false
  // Each open template expression `${`: the brace depth inside it.
  const templates: number[] = []
  let i = 0
  const n = src.length
  const push = (t: string) => {
    out.push({ t, line, nl })
    nl = false
  }
  /** Scan a template's text from i (just after ` or }) to its end or its next `${`. */
  const template = () => {
    while (i < n) {
      const c = src[i]
      if (c === "\\") i += 2
      else if (c === "`") {
        i++
        return
      } else if (c === "$" && src[i + 1] === "{") {
        i += 2
        templates.push(0)
        return
      } else {
        if (c === "\n") line++
        i++
      }
    }
  }
  while (i < n) {
    const c = src[i] as string
    if (c === "\n") {
      line++
      nl = true
      i++
      continue
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++
      continue
    }
    if (c === '"' || c === "'") {
      const start = line
      let j = i + 1
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1
      out.push({ t: "STR", line: start, nl })
      nl = false
      i = j + 1
      continue
    }
    if (c === "`") {
      push("STR")
      i++
      template()
      continue
    }
    if (c === "{" && templates.length) templates[templates.length - 1]!++
    if (c === "}" && templates.length) {
      if (templates.at(-1) === 0) {
        templates.pop()
        i++
        template()
        continue
      }
      templates[templates.length - 1]!--
    }
    if (/[A-Za-z_$\u0080-\uffff]/.test(c)) {
      let j = i + 1
      while (j < n && /[\w$\u0080-\uffff]/.test(src[j] as string)) j++
      push(src.slice(i, j))
      i = j
      continue
    }
    if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] ?? ""))) {
      let j = i + 1
      while (j < n && /[\w.]/.test(src[j] as string)) j++
      push("NUM")
      i = j
      continue
    }
    if (c === "/") {
      const prev = out.at(-1)?.t
      if (prev === undefined || REGEX_AFTER.has(prev)) {
        let j = i + 1
        let cls = false
        while (j < n && src[j] !== "\n") {
          const d = src[j]
          if (d === "\\") j++
          else if (d === "[") cls = true
          else if (d === "]") cls = false
          else if (d === "/" && !cls) break
          j++
        }
        j++
        while (j < n && /[a-z]/i.test(src[j] as string)) j++
        push("REGEX")
        i = j
        continue
      }
    }
    if (c === "?" && src[i + 1] === "." && /\d/.test(src[i + 2] ?? "")) {
      push("?")
      i++
      continue
    }
    const p = PUNCT3.find((x) => src.startsWith(x, i)) ?? PUNCT2.find((x) => src.startsWith(x, i)) ?? c
    push(p)
    i += p.length
  }
  return out
}

const KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "typeof",
  "new",
  "delete",
  "void",
  "throw",
  "await",
  "yield",
  "super",
  "import",
  "else",
  "do",
  "case",
  "in",
  "of",
  "instanceof",
  "with",
])
const MODIFIERS = new Set(["async", "static", "get", "set", "public", "private", "protected", "readonly", "override", "abstract", "declare", "*"])
const DECISIONS = new Set(["if", "for", "while", "case", "catch", "&&", "||", "??", "&&=", "||=", "??="])
/** Tokens that cannot end an expression: the next line continues it. */
const CONTINUE_END = new Set([
  "=>",
  "=",
  "(",
  "[",
  "{",
  ",",
  ".",
  "?.",
  "?",
  ":",
  "+",
  "-",
  "*",
  "/",
  "%",
  "&&",
  "||",
  "??",
  "|",
  "&",
  "<",
  ">",
  "==",
  "===",
  "!=",
  "!==",
])
/** Tokens that cannot start a statement: a line opening with one continues the one before. */
const CONTINUE_START = new Set([
  ".",
  "?.",
  "?",
  ":",
  "+",
  "-",
  "*",
  "/",
  "%",
  "&&",
  "||",
  "??",
  "|",
  "&",
  "=>",
  "=",
  ")",
  "]",
  "}",
  ",",
  "==",
  "===",
  "!=",
  "!==",
  "as",
  "satisfies",
])
const OBJECT_AFTER = new Set(["=", "(", ",", ":", "[", "return", "?", "||", "&&", "??", "...", "yield", "await"])
const TYPE_END = (t: string | undefined) => t !== undefined && (/^[\w$]/.test(t) || t === ">" || t === "]" || t === ")" || t === "}" || t === "STR")

type FrameKind = "block" | "object" | "class" | "type" | "fn" | "paren"
interface Frame {
  open: string
  kind: FrameKind
  fn?: Fn
}
interface Fn {
  name: string
  line: number
  end: number
  decisions: number
}
/** An arrow function whose body is an expression: it ends at the bracket depth it started at. */
interface ExprFn extends Fn {
  depth: number
}

const CLOSE: Record<string, string> = { ")": "(", "]": "[", "}": "{" }

/** The functions in a TypeScript or JavaScript text whose comments are blanked. */
export function jsFunctions(stripped: string): FunctionInfo[] {
  const toks = tokenize(stripped)
  // The index of each bracket's partner.
  const partner = new Map<number, number>()
  const open: number[] = []
  toks.forEach((tok, i) => {
    if (tok.t === "(" || tok.t === "[" || tok.t === "{") open.push(i)
    else if (CLOSE[tok.t]) {
      const o = open.pop()
      if (o !== undefined) {
        partner.set(o, i)
        partner.set(i, o)
      }
    }
  })
  const done: Fn[] = []
  const frames: Frame[] = []
  const exprs: ExprFn[] = []
  /** The `{` a function's body opens at, by its index: decided before the scan reaches it. */
  const bodies = new Map<number, Fn>()
  const braceKind = new Map<number, FrameKind>()
  // A type annotation in progress: the frame depth it started at, and whether `=>` ends it (an arrow's return type).
  let annotation: { depth: number; arrowEnds: boolean } | null = null
  let typeStatement: number | null = null
  const ternaries: number[] = [0]
  const innermostFn = (): Fn | undefined => {
    const e = exprs.at(-1)
    for (let k = frames.length - 1; k >= 0; k--) {
      const f = frames[k]!
      if (e && e.depth > k) return e
      if (f.fn) return f.fn
    }
    return e
  }
  /** After the `)` at index close, the index of the body's `{`, skipping a return type; -1 if there is none. */
  const bodyAfter = (close: number): number => {
    let j = close + 1
    if (toks[j]?.t === "{") return j
    if (toks[j]?.t !== ":") return -1
    j++
    let depth = 0
    for (; j < toks.length; j++) {
      const t = toks[j]!.t
      if (depth === 0 && t === "{" && TYPE_END(toks[j - 1]?.t) && toks[j - 1]?.t !== ":") return j
      if (t === "(" || t === "[" || t === "{" || t === "<") depth++
      else if (t === ")" || t === "]" || t === "}" || t === ">") depth--
      if (depth < 0 || (depth === 0 && (t === ";" || t === "=" || t === "=>" || t === ","))) return -1
      if (depth === 0 && toks[j]!.nl && (t === "function" || t === "export" || t === "const" || t === "let")) return -1
    }
    return -1
  }
  const endsStatement = (i: number): boolean => {
    const tok = toks[i]!
    return tok.t === ";" || (tok.nl && !CONTINUE_START.has(tok.t) && !CONTINUE_END.has(toks[i - 1]?.t ?? ""))
  }
  const finishExprs = (i: number, depth: number) => {
    while (exprs.length) {
      const e = exprs.at(-1)!
      const t = toks[i]?.t
      const closes = i >= toks.length || depth < e.depth || (depth === e.depth && (t === "," || endsStatement(i)))
      if (!closes) break
      e.end = toks[i - 1]?.line ?? e.line
      done.push(exprs.pop()!)
    }
  }
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i]!
    const t = tok.t
    const prev = toks[i - 1]?.t
    const depth = frames.length
    finishExprs(i, CLOSE[t] ? depth - 1 : depth)
    if (annotation && depth === annotation.depth) {
      if (t === "," || t === "=" || t === ";" || (annotation.arrowEnds && t === "=>") || endsStatement(i)) annotation = null
      else if (t === "{" && bodies.has(i)) annotation = null
    }
    if (annotation && depth < annotation.depth) annotation = null
    if (typeStatement !== null && depth === typeStatement && i > 0 && endsStatement(i) && toks[i - 1]?.t !== "=") typeStatement = null
    const inType = annotation !== null || typeStatement !== null || frames.at(-1)?.kind === "type"
    // The decisions in the innermost function's body.
    if (!inType) {
      const fn = innermostFn()
      const ternary = t === "?" && toks[i + 1]?.t !== ":" && toks[i + 1]?.t !== ")" && toks[i + 1]?.t !== ","
      if (fn && (DECISIONS.has(t) || ternary)) fn.decisions++
      if (ternary) ternaries[depth] = (ternaries[depth] ?? 0) + 1
    }
    if (t === "(" || t === "[" || t === "{") {
      let kind: FrameKind = t === "{" ? "block" : "paren"
      let fn: Fn | undefined
      if (t === "{") {
        fn = bodies.get(i)
        if (fn) kind = "fn"
        else if (braceKind.has(i)) kind = braceKind.get(i)!
        else if (inType) kind = "type"
        else if (prev !== undefined && OBJECT_AFTER.has(prev)) kind = "object"
      }
      frames.push({ open: t, kind, ...(fn ? { fn } : {}) })
      ternaries[frames.length] = 0
      continue
    }
    if (CLOSE[t]) {
      const f = frames.pop()
      if (f?.fn) {
        f.fn.end = tok.line
        done.push(f.fn)
      }
      continue
    }
    if (inType) continue
    if (t === "interface" && /^[\w$]/.test(toks[i + 1]?.t ?? "")) {
      for (let j = i + 1; j < toks.length; j++) {
        if (toks[j]!.t === "{") {
          braceKind.set(j, "type")
          break
        }
      }
      continue
    }
    if (t === "type" && /^[A-Za-z_$]/.test(toks[i + 1]?.t ?? "") && (toks[i + 2]?.t === "=" || toks[i + 2]?.t === "<") && prev !== "." && prev !== "import") {
      typeStatement = depth
      continue
    }
    if (t === "class" && (/^[A-Za-z_$]/.test(toks[i + 1]?.t ?? "") || toks[i + 1]?.t === "{") && toks[i + 1]?.t !== ":" && prev !== ".") {
      for (let j = i + 1; j < toks.length; j++) {
        if (toks[j]!.t === "{") {
          braceKind.set(j, "class")
          break
        }
      }
      continue
    }
    if (t === "function") {
      let j = i + 1
      if (toks[j]?.t === "*") j++
      const name = /^[A-Za-z_$]/.test(toks[j]?.t ?? "") && toks[j]?.t !== "(" ? toks[j++]!.t : "(anonymous)"
      if (toks[j]?.t === "<") { while (j < toks.length && toks[j]!.t !== "(") j++ }
      const close = toks[j]?.t === "(" ? partner.get(j) : undefined
      const body = close === undefined ? -1 : bodyAfter(close)
      if (body >= 0) bodies.set(body, { name, line: tok.line, end: tok.line, decisions: 0 })
      continue
    }
    if (t === ":") {
      const kind = frames.at(-1)?.kind
      if ((ternaries[depth] ?? 0) > 0) ternaries[depth]!--
      else if (prev === ")" && toks[partner.get(i - 1) ?? -1] !== undefined) {
        // a return type: `(a): T =>` or a method's, whose body bodyAfter already found
        annotation = { depth, arrowEnds: true }
      } else if (kind === "paren" || kind === "class" || (kind !== "object" && /^(const|let|var)$/.test(toks[i - 2]?.t ?? ""))) {
        annotation = { depth, arrowEnds: false }
      } else if (kind !== "object" && (prev === "?" || prev === "!") && /^(const|let|var)$/.test(toks[i - 3]?.t ?? "")) {
        annotation = { depth, arrowEnds: false }
      }
      continue
    }
    if (t === "=>") {
      // the arrow's first line: its parameters' opening, or its one parameter
      let start = tok.line
      let name = "(arrow)"
      let k = i - 1
      if (toks[k]?.t === ")" && partner.has(k)) k = partner.get(k)!
      else if (toks[k] && /^[A-Za-z_$]/.test(toks[k]!.t) && toks[k - 1]?.t !== ":") {
        // one parameter, unparenthesised: `x => …`
      } else {
        // a return type sits between the parameters and the arrow: find the `)` before the annotation's `:`
        for (let j = i - 1, d = 0; j > 0; j--) {
          const u = toks[j]!.t
          if (u === ")" || u === "]" || u === "}" || u === ">") d++
          else if (u === "(" || u === "[" || u === "{" || u === "<") d--
          else if (d === 0 && u === ":" && toks[j - 1]?.t === ")") {
            k = partner.get(j - 1) ?? j
            break
          }
          if (d < 0 || (d === 0 && (u === "=" || u === ";" || u === ","))) break
        }
      }
      if (toks[k]) start = toks[k]!.line
      const before = toks[k - 1]?.t === "async" ? k - 2 : k - 1
      if ((toks[before]?.t === "=" || toks[before]?.t === ":") && /^[A-Za-z_$]/.test(toks[before - 1]?.t ?? "")) name = toks[before - 1]!.t
      if (toks[i + 1]?.t === "{") bodies.set(i + 1, { name, line: start, end: start, decisions: 0 })
      else exprs.push({ name, line: start, end: start, decisions: 0, depth })
      continue
    }
    // a method: in a class or an object literal, a name, its parameters, its body
    const kind = frames.at(-1)?.kind
    if ((kind === "class" || kind === "object") && /^[A-Za-z_$#]/.test(t) && !KEYWORDS.has(t) && toks[i + 1]?.t === "(") {
      const lead = prev === undefined || prev === "{" || prev === "}" || prev === ";" || prev === "," || MODIFIERS.has(prev) || toks[i]!.nl
      const close = partner.get(i + 1)
      if (lead && close !== undefined) {
        const body = bodyAfter(close)
        if (body >= 0) bodies.set(body, { name: t, line: tok.line, end: tok.line, decisions: 0 })
      }
    }
  }
  finishExprs(toks.length, 0)
  return done
    .map((f) => ({ name: f.name, line: f.line, lines: Math.max(1, f.end - f.line + 1), complexity: 1 + f.decisions }))
    .sort((a, b) => a.line - b.line)
}

// ---- the languages Naima knows ------------------------------------------------

const JS_QUOTES = ['"', "'", "`"]

/** The languages the program ships: their files, comments, and for TS/JS their functions. */
export const builtinLanguages: Language[] = [
  {
    id: "typescript",
    says: "TypeScript",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    code: true,
    comments: C_LIKE,
    quotes: JS_QUOTES,
    regex: true,
    functions: jsFunctions,
  },
  {
    id: "javascript",
    says: "JavaScript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    code: true,
    comments: C_LIKE,
    quotes: JS_QUOTES,
    regex: true,
    functions: jsFunctions,
  },
  { id: "python", says: "Python", extensions: [".py"], code: true, comments: HASH },
  { id: "rust", says: "Rust", extensions: [".rs"], code: true, comments: C_LIKE },
  { id: "go", says: "Go", extensions: [".go"], code: true, comments: C_LIKE, quotes: ['"', "`"] },
  { id: "java", says: "Java", extensions: [".java"], code: true, comments: C_LIKE },
  { id: "kotlin", says: "Kotlin", extensions: [".kt", ".kts"], code: true, comments: C_LIKE },
  { id: "c", says: "C", extensions: [".c", ".h"], code: true, comments: C_LIKE },
  { id: "cpp", says: "C++", extensions: [".cc", ".cpp", ".cxx", ".hpp", ".hh"], code: true, comments: C_LIKE },
  { id: "csharp", says: "C#", extensions: [".cs"], code: true, comments: C_LIKE },
  { id: "swift", says: "Swift", extensions: [".swift"], code: true, comments: C_LIKE },
  { id: "ruby", says: "Ruby", extensions: [".rb"], code: true, comments: HASH },
  { id: "shell", says: "shell scripts", extensions: [".sh", ".bash", ".zsh"], code: true, comments: HASH },
  { id: "mcrl2", says: "mCRL2 models", extensions: [".mcrl2", ".mcf"], code: true, comments: { line: ["%"] } },
  { id: "css", says: "CSS", extensions: [".css"], code: false, comments: { block: [["/*", "*/"]] } },
  { id: "html", says: "HTML", extensions: [".html", ".htm"], code: false, comments: { block: [["<!--", "-->"]] }, quotes: [] },
  { id: "markdown", says: "Markdown", extensions: [".md"], code: false, quotes: [] },
  { id: "json", says: "JSON", extensions: [".json", ".jsonc"], code: false, comments: C_LIKE, quotes: ['"'] },
  { id: "yaml", says: "YAML", extensions: [".yml", ".yaml"], code: false, comments: HASH },
]

// ---- what a measure reads: the files of a tree --------------------------------

/** The files of one tree: the working tree, or a commit read from git's objects. */
export interface CodeSource {
  /** Paths relative to the root, with forward slashes. */
  files: string[]
  /** A file's text; null for a binary file, a directory, or one too large to read. */
  read(path: string): string | null
}

const MAX_BYTES = 2 * 1024 * 1024
const textOf = (bytes: Uint8Array): string | null => (bytes.length > MAX_BYTES || bytes.includes(0) ? null : new TextDecoder().decode(bytes))

const gitLines = (root: string, args: string[]): string[] => {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${(r.stderr ?? "").trim() || `exited ${r.status}`}`)
  return r.stdout.split("\0").filter(Boolean)
}

/** The same, against a repository named by its git directory directly: no working tree needed, so a submodule not checked out still answers. */
const gitDirLines = (gitDir: string, args: string[]): string[] => {
  const r = spawnSync("git", ["--git-dir", gitDir, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${(r.stderr ?? "").trim() || `exited ${r.status}`}`)
  return r.stdout.split("\0").filter(Boolean)
}

/** Where a submodule at `path` keeps its objects — `.git/modules/<path>` under root's common git directory, or the submodule's own checked-out `.git` — whichever exists; null when neither does (never cloned, or deinited). */
function submoduleGitDir(root: string, path: string): string | null {
  const common = gitLines(root, ["rev-parse", "--git-common-dir"])[0] ?? ".git"
  const commonAbs = common.startsWith("/") ? common : join(root, common)
  const modules = join(commonAbs, "modules", path)
  if (existsSync(join(modules, "HEAD"))) return modules
  const own = join(root, path, ".git")
  if (existsSync(own)) return own
  return null
}

/** The working tree as git sees it: tracked files and untracked ones not ignored, a submodule's own files included, the tracker's own directory left out. */
export function workingTreeSource(root: string, leaveOut: string[] = []): CodeSource {
  const outside = (p: string) => !leaveOut.some((d) => p === d || p.startsWith(`${d}/`))
  // `--recurse-submodules` only works with `--cached` alone: it refuses to combine with `--others`/`--exclude-standard`, so untracked files are a second call.
  const files = [
    ...new Set([
      ...gitLines(root, ["ls-files", "-z", "--cached", "--recurse-submodules"]),
      ...gitLines(root, ["ls-files", "-z", "--others", "--exclude-standard"]),
    ]),
  ].filter(outside).filter((p) => existsSync(join(root, p))).sort()
  return {
    files,
    read(path) {
      try {
        const full = join(root, path)
        if (!statSync(full).isFile()) return null
        return textOf(readFileSync(full))
      } catch {
        return null
      }
    },
  }
}

/** A blob this source can later read, and the repository it lives in: null for the root repository itself, a submodule's git directory otherwise. */
interface SourceEntry {
  path: string
  oid: string
  gitDir: string | null
}

/** A commit's tree, read from git's objects: no checkout, nothing written. A gitlink entry (a submodule) is followed into its own repository at the commit it names; a gitlink whose commit is not there is reported in one line and counted as no files. */
export function commitSource(root: string, commit: string, leaveOut: string[] = []): CodeSource {
  const outside = (p: string) => !leaveOut.some((d) => p === d || p.startsWith(`${d}/`))
  const entries: SourceEntry[] = []
  for (const e of gitLines(root, ["ls-tree", "-r", "-z", commit])) {
    const tab = e.indexOf("\t")
    const [, type, oid] = e.slice(0, tab).split(" ")
    const path = e.slice(tab + 1)
    if (!oid || !outside(path)) continue
    if (type === "blob") {
      entries.push({ path, oid, gitDir: null })
      continue
    }
    if (type !== "commit") continue // a tree entry: ls-tree -r already flattened it away
    const gitDir = submoduleGitDir(root, path)
    if (!gitDir) {
      console.error(`naima: submodule ${path} has no local repository (never cloned, or deinited) — its files are counted as 0`)
      continue
    }
    let subLines: string[]
    try {
      subLines = gitDirLines(gitDir, ["ls-tree", "-r", "-z", oid])
    } catch {
      console.error(`naima: submodule ${path} is missing commit ${oid} — its files are counted as 0`)
      continue
    }
    for (const se of subLines) {
      const t2 = se.indexOf("\t")
      const [, subType, subOid] = se.slice(0, t2).split(" ")
      const subPath = `${path}/${se.slice(t2 + 1)}`
      if (subType === "blob" && subOid && outside(subPath)) entries.push({ path: subPath, oid: subOid, gitDir })
    }
  }
  const byPath = new Map(entries.map((e) => [e.path, e]))
  let texts: Map<string, string | null> | null = null
  const load = (): Map<string, string | null> => {
    const out = new Map<string, string | null>()
    const byGitDir = new Map<string | null, SourceEntry[]>()
    for (const e of entries) byGitDir.set(e.gitDir, [...(byGitDir.get(e.gitDir) ?? []), e])
    for (const [gitDir, es] of byGitDir) {
      if (!es.length) continue
      const args = ["cat-file", "--batch"]
      const r = gitDir === null
        ? spawnSync("git", args, { cwd: root, input: es.map((e) => e.oid).join("\n") + "\n", maxBuffer: 1024 * 1024 * 1024 })
        : spawnSync("git", ["--git-dir", gitDir, ...args], { input: es.map((e) => e.oid).join("\n") + "\n", maxBuffer: 1024 * 1024 * 1024 })
      if (r.status !== 0) throw new Error(`git cat-file: ${String(r.stderr ?? "").trim()}`)
      const buf = r.stdout as unknown as Uint8Array
      const byOid = new Map<string, string | null>()
      let at = 0
      while (at < buf.length) {
        const eol = buf.indexOf(10, at)
        if (eol < 0) break
        const [oid, type, size] = new TextDecoder().decode(buf.subarray(at, eol)).split(" ")
        at = eol + 1
        if (type === "missing" || !oid) continue
        const len = Number(size)
        byOid.set(oid, textOf(buf.subarray(at, at + len)))
        at += len + 1
      }
      for (const e of es) out.set(e.path, byOid.get(e.oid) ?? null)
    }
    return out
  }
  return {
    files: [...byPath.keys()].sort(),
    read(path) {
      texts ??= load()
      return texts.get(path) ?? null
    },
  }
}

// ---- measures ------------------------------------------------------------------

/** What a code measure is asked with: the metric's selection of files, each already analysed. */
export interface MeasureInput {
  /** The files the metric selects, with their language. */
  files: AnalysedFile[]
  /** The files of the tree the metric's include and exclude select, whatever their language: for a measure that reads
   * files no language claims (a manifest). */
  source: CodeSource
}

export interface AnalysedFile {
  path: string
  language: Language
  text: string
  stripped: string
  codeLines: number
  /** The functions its language found; undefined when the language finds none. */
  functions: FunctionInfo[] | undefined
}

/** The options of a metric a code measure reads. */
export interface MeasureOptions {
  statistic?: string
  window?: number
  pattern?: string
}

/** A code-quality number taken in process: what any plugin contributes to the `code-measures` point. */
export interface CodeMeasure {
  id: string
  says: string
  unit: string
  /** Whether a higher number is better, a lower one, or neither: how a change is read. */
  better: "higher" | "lower" | "neither"
  measure(input: MeasureInput, metric: MeasureOptions): number | { error: string }
}

export const STATISTICS = ["mean", "median", "p90", "max", "sum"] as const

/** A statistic of a list of numbers, rounded to two decimals; 0 for none. */
export function statistic(values: number[], which = "mean"): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const round = (x: number) => Math.round(x * 100) / 100
  if (which === "max") return sorted.at(-1)!
  if (which === "sum") return sorted.reduce((a, b) => a + b, 0)
  if (which === "median") return round(sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2)
  if (which === "p90") return sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)]!
  return round(sorted.reduce((a, b) => a + b, 0) / sorted.length)
}

/** Lines that say something: trimmed, spaces collapsed, at least three word characters. A closing brace is not a duplicate. */
const significant = (stripped: string): string[] =>
  stripped.split("\n").map((l) => l.trim().replace(/\s+/g, " ")).filter((l) => (l.match(/\w/g)?.length ?? 0) >= 3)

/** The share of significant lines, in percent, that sit in a window of `window` consecutive lines repeated elsewhere. */
export function duplication(files: { stripped: string }[], window = 6): { duplicated: number; total: number; percent: number } {
  const seqs = files.map((f) => significant(f.stripped))
  const seen = new Map<string, number>()
  for (const s of seqs) {
    for (let i = 0; i + window <= s.length; i++) seen.set(s.slice(i, i + window).join("\n"), (seen.get(s.slice(i, i + window).join("\n")) ?? 0) + 1)
  }
  let duplicated = 0
  let total = 0
  for (const s of seqs) {
    const marked = new Array<boolean>(s.length).fill(false)
    for (let i = 0; i + window <= s.length; i++) if ((seen.get(s.slice(i, i + window).join("\n")) ?? 0) > 1) marked.fill(true, i, i + window)
    duplicated += marked.filter(Boolean).length
    total += s.length
  }
  return { duplicated, total, percent: total ? Math.round((duplicated / total) * 10000) / 100 : 0 }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const keys = (v: unknown): number => (isObj(v) ? Object.keys(v).length : 0)

/** How many dependencies a manifest declares: package.json, deno.json(c), requirements.txt, go.mod, Cargo.toml. */
export function dependenciesIn(name: string, text: string): number {
  try {
    if (name === "package.json") {
      const j = JSON.parse(text) as Record<string, unknown>
      return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].reduce((n, k) => n + keys(j[k]), 0)
    }
    if (name === "deno.json" || name === "deno.jsonc") {
      const j = JSON.parse(stripComments(text, { comments: C_LIKE, quotes: ['"'] })) as Record<string, unknown>
      return keys(j["imports"])
    }
  } catch {
    return 0
  }
  const lines = text.split("\n").map((l) => l.trim())
  if (name === "requirements.txt") return lines.filter((l) => l && !l.startsWith("#") && !l.startsWith("-")).length
  if (name === "go.mod") {
    let inBlock = false
    let n = 0
    for (const l of lines) {
      if (/^require\s*\(/.test(l)) inBlock = true
      else if (inBlock && l === ")") inBlock = false
      else if (inBlock && l && !l.startsWith("//")) n++
      else if (/^require\s+\S+\s+\S+/.test(l)) n++
    }
    return n
  }
  if (name === "Cargo.toml") {
    let inDeps = false
    let n = 0
    for (const l of lines) {
      if (l.startsWith("[")) inDeps = /^\[(.+\.)?(dev-|build-)?dependencies\]$/.test(l)
      else if (inDeps && /^[\w-]+\s*=/.test(l)) n++
    }
    return n
  }
  return 0
}

const MANIFESTS = new Set(["package.json", "deno.json", "deno.jsonc", "requirements.txt", "go.mod", "Cargo.toml"])
const MARKERS = "\\b(TODO|FIXME|XXX|HACK)\\b"

const fnMeasure = (id: string, says: string, unit: string, of: (f: FunctionInfo) => number): CodeMeasure => ({
  id,
  says,
  unit,
  better: "lower",
  measure: (input, m) => {
    const fns = input.files.flatMap((f) => f.functions ?? [])
    return statistic(fns.map(of), m.statistic)
  },
})

/** The measures the program ships. */
export const builtinMeasures: CodeMeasure[] = [
  {
    id: "loc",
    says: "lines of code: lines with code on them, comments and blank lines left out",
    unit: "lines",
    better: "neither",
    measure: (i) => i.files.reduce((n, f) => n + f.codeLines, 0),
  },
  { id: "files", says: "how many files, of the languages selected", unit: "files", better: "neither", measure: (i) => i.files.length },
  {
    id: "functions",
    says: "how many functions, methods and arrow functions, in the languages that find them (TypeScript, JavaScript)",
    unit: "functions",
    better: "neither",
    measure: (i) => i.files.reduce((n, f) => n + (f.functions?.length ?? 0), 0),
  },
  fnMeasure("function-size", "lines per function: a `statistic` of them — mean (default), median, p90, max or sum", "lines", (f) => f.lines),
  fnMeasure(
    "complexity",
    "cyclomatic complexity per function, estimated: a `statistic` of it — mean (default), median, p90, max or sum",
    "",
    (f) => f.complexity,
  ),
  {
    id: "duplication",
    says: "the share of code lines inside a run of `window` (default 6) consecutive lines that appears more than once",
    unit: "%",
    better: "lower",
    measure: (i, m) => duplication(i.files, m.window ?? 6).percent,
  },
  {
    id: "todos",
    says: "how many TODO, FIXME, XXX and HACK markers the files carry — or matches of `pattern`",
    unit: "markers",
    better: "lower",
    measure: (i, m) => {
      const re = new RegExp(m.pattern ?? MARKERS, "g")
      return i.files.reduce((n, f) => n + (f.text.match(re)?.length ?? 0), 0)
    },
  },
  {
    id: "dependencies",
    says: "how many dependencies the manifests declare: package.json, deno.json(c) imports, requirements.txt, go.mod, Cargo.toml",
    unit: "dependencies",
    better: "lower",
    measure: (i) =>
      i.source.files.reduce((n, p) => {
        const name = p.split("/").at(-1) ?? p
        if (!MANIFESTS.has(name) || p.split("/").includes("node_modules")) return n
        const text = i.source.read(p)
        return n + (text === null ? 0 : dependenciesIn(name, text))
      }, 0),
  },
]

/** Does a path match a selection: a path prefix ("src", "src/core"), or a pattern with * and ** ("**\/*.test.ts"). */
export const matches = pathMatches

const cacheOf = new WeakMap<CodeSource, Map<string, AnalysedFile | null>>()

/** `source` narrowed to the paths a metric's include and exclude select, of any language. */
export function selectSource(source: CodeSource, select: { include?: string[]; exclude?: string[] }): CodeSource {
  const files = source.files.filter((path) =>
    !(select.include?.length && !select.include.some((p) => matches(path, p))) && !select.exclude?.some((p) => matches(path, p))
  )
  return { files, read: (path) => source.read(path) }
}

/** The files of `source` a metric selects, analysed once per source and shared by every metric that reads them. */
export function selectFiles(
  source: CodeSource,
  languages: Language[],
  select: { language?: string | string[]; include?: string[]; exclude?: string[] },
): AnalysedFile[] {
  const wanted = select.language === undefined ? null : new Set([select.language].flat())
  const byExt = new Map<string, Language>()
  for (const l of languages) for (const e of l.extensions) if (!byExt.has(e)) byExt.set(e, l)
  let cache = cacheOf.get(source)
  if (!cache) cacheOf.set(source, cache = new Map())
  const out: AnalysedFile[] = []
  for (const path of source.files) {
    if (select.include?.length && !select.include.some((p) => matches(path, p))) continue
    if (select.exclude?.some((p) => matches(path, p))) continue
    const dot = path.lastIndexOf(".")
    const lang = dot > path.lastIndexOf("/") ? byExt.get(path.slice(dot).toLowerCase()) : undefined
    if (!lang || (wanted ? !wanted.has(lang.id) : !lang.code)) continue
    if (!cache.has(path)) {
      const text = source.read(path)
      if (text === null) cache.set(path, null)
      else {
        const stripped = stripComments(text, lang)
        let functions: FunctionInfo[] | undefined
        try {
          functions = lang.functions?.(stripped)
        } catch {
          functions = []
        }
        cache.set(path, { path, language: lang, text, stripped, codeLines: codeLineCount(stripped), functions })
      }
    }
    const f = cache.get(path)
    if (f) out.push(f)
  }
  return out
}
