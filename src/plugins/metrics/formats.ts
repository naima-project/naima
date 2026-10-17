// How a test suite's machine-readable output is read: one recorded result per
// test. Three formats ship, and any plugin may add one through the
// `test-formats` point:
//
//   junit        JUnit XML: pytest --junit-xml, deno test --reporter=junit,
//                node --test-reporter=junit, bun test --reporter=junit, and
//                most other runners and CI tools.
//   tap          the Test Anything Protocol, versions 13 and 14, with
//                indented subtests: deno test --reporter=tap,
//                node --test-reporter=tap, and many others.
//   libtest-json the JSON lines Rust's test harness prints with
//                `--format json` (cargo test).
//
// JUnit is XML, so it is read by an XML parser (below: elements, attributes,
// text, CDATA, comments, entities), never by patterns over the text. TAP and
// libtest's JSON are line formats, read a line at a time.

/** One test as a run recorded it. */
export interface TestResult {
  /** Its name, with the names of the groups around it before it, joined by ` > ` (libtest's own `::` kept). */
  name: string
  /** The file or class it is in, when the format says. */
  file?: string
  result: "passed" | "failed" | "skipped"
  /** How long it took, when the format says. */
  seconds?: number
  /** For a failure: what the runner said, its message and its trace. */
  message?: string
}

/** How a suite's output is read: what any plugin contributes to the `test-formats` point. */
export interface TestFormat {
  id: string
  says: string
  /** Every test the output records, or why it cannot be read. */
  parse(text: string): TestResult[] | { error: string }
}

// ── XML ──────────────────────────────────────────────────────────────────────

/** An XML element: its name, its attributes, and its children in order — elements and text. */
export interface XmlElement {
  name: string
  attributes: Record<string, string>
  children: (XmlElement | string)[]
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }

/** Text with its character and entity references replaced. An unknown entity is kept as written. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][\w.-]*);/g, (whole, ref: string) => {
    if (ref.startsWith("#x")) return String.fromCodePoint(parseInt(ref.slice(2), 16))
    if (ref.startsWith("#")) return String.fromCodePoint(parseInt(ref.slice(1), 10))
    return ENTITIES[ref] ?? whole
  })
}

const NAME_CHAR = /[A-Za-z0-9_.:\-·À-￿]/

/**
 * Parse an XML document into its root element. Reads the prolog, comments, processing instructions, a DOCTYPE
 * (skipped), CDATA sections, elements with single- or double-quoted attributes, and character and entity
 * references. Throws, saying where, on a document that is not well formed.
 */
export function parseXml(text: string): XmlElement {
  let i = 0
  const fail = (why: string): never => {
    const line = text.slice(0, i).split("\n").length
    throw new Error(`${why}, line ${line}`)
  }
  const skipSpace = () => {
    while (i < text.length && /\s/.test(text[i] as string)) i++
  }
  const readName = (): string => {
    const start = i
    while (i < text.length && NAME_CHAR.test(text[i] as string)) i++
    if (i === start) fail("a name was expected")
    return text.slice(start, i)
  }
  const skipUntil = (end: string) => {
    const at = text.indexOf(end, i)
    if (at < 0) fail(`no closing ${end}`)
    i = at + end.length
  }
  /** Skip what may stand between elements: comments, processing instructions, a DOCTYPE. True if something was skipped. */
  const skipMisc = (): boolean => {
    if (text.startsWith("<!--", i)) return skipUntil("-->"), true
    if (text.startsWith("<?", i)) return skipUntil("?>"), true
    if (text.startsWith("<!DOCTYPE", i)) {
      // A DOCTYPE may hold an internal subset in brackets: skip to the > after it.
      let depth = 0
      for (; i < text.length; i++) {
        const c = text[i]
        if (c === "[") depth++
        else if (c === "]") depth--
        else if (c === ">" && depth <= 0) {
          i++
          return true
        }
      }
      fail("no closing > for the DOCTYPE")
    }
    return false
  }
  const readElement = (): XmlElement => {
    if (text[i] !== "<") fail("an element was expected")
    i++
    const name = readName()
    const attributes: Record<string, string> = {}
    for (;;) {
      skipSpace()
      if (text.startsWith("/>", i)) {
        i += 2
        return { name, attributes, children: [] }
      }
      if (text[i] === ">") {
        i++
        break
      }
      const key = readName()
      skipSpace()
      if (text[i] !== "=") fail(`attribute ${key} has no value`)
      i++
      skipSpace()
      const quote = text[i]
      if (quote !== '"' && quote !== "'") fail(`attribute ${key}'s value is not quoted`)
      const end = text.indexOf(quote as string, i + 1)
      if (end < 0) fail(`attribute ${key}'s value is not closed`)
      attributes[key] = decodeEntities(text.slice(i + 1, end))
      i = end + 1
    }
    const children: (XmlElement | string)[] = []
    let textRun = ""
    const flush = () => {
      if (textRun) children.push(decodeEntities(textRun))
      textRun = ""
    }
    for (;;) {
      if (i >= text.length) fail(`element ${name} is not closed`)
      if (text.startsWith("</", i)) {
        flush()
        i += 2
        const closing = readName()
        if (closing !== name) fail(`</${closing}> closes <${name}>`)
        skipSpace()
        if (text[i] !== ">") fail(`</${closing} is not closed`)
        i++
        return { name, attributes, children }
      }
      if (text.startsWith("<![CDATA[", i)) {
        const end = text.indexOf("]]>", i)
        if (end < 0) fail("a CDATA section is not closed")
        flush()
        children.push(text.slice(i + 9, end))
        i = end + 3
        continue
      }
      if (text.startsWith("<!--", i) || text.startsWith("<?", i)) {
        skipMisc()
        continue
      }
      if (text[i] === "<") {
        flush()
        children.push(readElement())
        continue
      }
      textRun += text[i]
      i++
    }
  }
  if (text.charCodeAt(0) === 0xfeff) i = 1
  for (;;) {
    skipSpace()
    if (!skipMisc()) break
  }
  const root = readElement()
  for (;;) {
    skipSpace()
    if (!skipMisc()) break
  }
  if (i < text.length) fail("text after the root element")
  return root
}

/** An element's text: its own and its descendants', in order. */
export const textOf = (e: XmlElement): string => e.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("")

// ── shared ───────────────────────────────────────────────────────────────────

// deno-lint-ignore no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g

/** The longest a test's message is kept, in characters: its start, where the failure is said. */
export const MESSAGE_LIMIT = 4000

const cleanMessage = (s: string): string | undefined => {
  const t = s.replace(ANSI, "").trim()
  if (!t) return undefined
  return t.length > MESSAGE_LIMIT ? `${t.slice(0, MESSAGE_LIMIT)}\n[… ${t.length - MESSAGE_LIMIT} more characters]` : t
}

const secondsOf = (v: unknown, scale = 1): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? Math.round((n / scale) * 1e6) / 1e6 : undefined
}

const result = (r: TestResult): TestResult => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined && v !== "")) as unknown as TestResult

// ── JUnit ────────────────────────────────────────────────────────────────────

/**
 * Every `<testcase>` of a JUnit report. A case is failed with a `<failure>` or an `<error>`, skipped with a
 * `<skipped>`, passed otherwise. Its file is its `file` attribute, else its `classname`; its name is the names of
 * the `<testsuite>`s around it, outermost first, then its own — a suite named as its file left out.
 */
export function parseJunit(text: string): TestResult[] | { error: string } {
  let root: XmlElement
  try {
    root = parseXml(text)
  } catch (e) {
    return { error: `the report is not well-formed XML: ${(e as Error).message}` }
  }
  if (root.name !== "testsuites" && root.name !== "testsuite") return { error: `the report's root is <${root.name}>, not <testsuites> or <testsuite>` }
  const out: TestResult[] = []
  const walk = (e: XmlElement, suites: string[]) => {
    for (const c of e.children) {
      if (typeof c === "string") continue
      if (c.name === "testsuite") walk(c, [...suites, c.attributes["name"] ?? ""])
      else if (c.name === "testcase") out.push(testcase(c, suites))
    }
  }
  walk(root, root.name === "testsuite" ? [root.attributes["name"] ?? ""] : [])
  return out
}

function testcase(c: XmlElement, suites: string[]): TestResult {
  const name = c.attributes["name"] ?? ""
  const classname = c.attributes["classname"] ?? ""
  const file = c.attributes["file"] || classname || undefined
  const groups = suites.filter((s) => s && s !== file)
  const els = c.children.filter((x): x is XmlElement => typeof x !== "string")
  const failure = els.find((x) => x.name === "failure" || x.name === "error")
  const skipped = els.some((x) => x.name === "skipped")
  let message: string | undefined
  if (failure) {
    const said = failure.attributes["message"] ?? ""
    const body = textOf(failure).trim()
    const out = els.filter((x) => x.name === "system-out" || x.name === "system-err").map(textOf).join("\n").trim()
    // The message attribute first: it is the one line a runner means as the summary.
    message = cleanMessage([said, body === said.trim() ? "" : body, out].filter(Boolean).join("\n"))
  }
  return result({
    name: [...groups, name].join(" > "),
    ...(file ? { file } : {}),
    result: failure ? "failed" : skipped ? "skipped" : "passed",
    ...(secondsOf(c.attributes["time"]) !== undefined ? { seconds: secondsOf(c.attributes["time"]) as number } : {}),
    ...(message ? { message } : {}),
  })
}

// ── TAP ──────────────────────────────────────────────────────────────────────

const POINT = /^(not )?ok\b(?:\s+(\d+))?(?:\s*-)?\s*(.*)$/
/** A directive after an unescaped `#`: SKIP or TODO, any case, with what follows it. */
const DIRECTIVE = /(?:^|[^\\])#\s*(skip|todo)\b/i
const SUBTEST = /^#\s*Subtest:\s*(.*)$/
/** A comment that names a file, as `deno test --reporter=tap` heads each file's tests: `# ./a.test.ts`. */
const FILE_COMMENT = /^#\s+((?:\.{1,2}\/|\/|file:\/\/)\S+)$/

/** The YAML a TAP producer writes after a test point, as far as a test's record reads it: flat keys, quoted and block scalars, or one JSON object. */
export function parseTapYaml(lines: string[]): Record<string, unknown> {
  const body = lines.join("\n").trim()
  if (body.startsWith("{")) {
    try {
      const v = JSON.parse(body)
      return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
    } catch {
      return {}
    }
  }
  const indentOf = (l: string) => l.length - l.trimStart().length
  const base = Math.min(...lines.filter((l) => l.trim()).map(indentOf))
  const out: Record<string, unknown> = {}
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n] as string
    if (!line.trim() || indentOf(line) !== base) continue
    const colon = line.indexOf(":")
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    const rest = line.slice(colon + 1).trim()
    if (/^[|>][-+]?$/.test(rest) || rest === "") {
      // A block scalar, or a nested map or list: the more-indented lines after it.
      const block: string[] = []
      while (n + 1 < lines.length && (!(lines[n + 1] as string).trim() || indentOf(lines[n + 1] as string) > base)) block.push(lines[++n] as string)
      if (rest === "") continue
      const inner = Math.min(...block.filter((l) => l.trim()).map(indentOf))
      const joined = block.map((l) => l.slice(Number.isFinite(inner) ? inner : 0))
      out[key] = rest.startsWith(">") ? joined.join(" ").trim() : joined.join("\n").replace(/\n+$/, "")
    } else if (rest.startsWith("'")) {
      out[key] = rest.slice(1, rest.lastIndexOf("'") > 0 ? rest.lastIndexOf("'") : undefined).replace(/''/g, "'")
    } else if (rest.startsWith('"')) {
      try {
        out[key] = JSON.parse(rest)
      } catch {
        out[key] = rest.slice(1, -1)
      }
    } else out[key] = /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(rest) ? Number(rest) : rest
  }
  return out
}

/**
 * Every test point of a TAP stream, subtests included. A subtest is indented four spaces under its parent and
 * announced by `# Subtest: <name>`; its name is its parents' names and its own, joined by ` > `. A point whose YAML
 * says `type: 'suite'` (node's describe) is a group, not a test. `# SKIP` is skipped; `# TODO` is skipped when it
 * fails, passed when it passes. `Bail out!` ends the stream as an error.
 */
export function parseTap(text: string): TestResult[] | { error: string } {
  const lines = text.replace(ANSI, "").split(/\r?\n/)
  const out: TestResult[] = []
  const headers: string[] = []
  let file: string | undefined
  let sawPlanOrPoint = false
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n] as string
    const indent = raw.length - raw.trimStart().length
    const level = Math.floor(indent / 4)
    const line = raw.trim()
    if (/^Bail out!/i.test(line)) return { error: `the run bailed out: ${line}` }
    if (/^TAP version \d+$/i.test(line) || /^\d+\.\.\d+/.test(line)) {
      sawPlanOrPoint = true
      continue
    }
    const sub = SUBTEST.exec(line)
    if (sub) {
      headers[level] = (sub[1] ?? "").trim()
      headers.length = level + 1
      continue
    }
    if (level === 0) {
      const f = FILE_COMMENT.exec(line)
      if (f) {
        file = f[1]
        continue
      }
    }
    const point = POINT.exec(line)
    if (!point) continue
    sawPlanOrPoint = true
    const failed = point[1] === "not "
    let description = point[3] ?? ""
    const directive = DIRECTIVE.exec(description)
    if (directive) description = description.slice(0, directive.index + (directive[0].startsWith("#") ? 0 : 1))
    description = description.trim().replace(/\\#/g, "#")
    // The YAML block after the point: from `---` to `...`, indented past the point.
    let yaml: Record<string, unknown> = {}
    const next = lines[n + 1]
    if (next !== undefined && next.trim() === "---" && next.length - next.trimStart().length > indent) {
      const block: string[] = []
      n += 2
      for (; n < lines.length && (lines[n] as string).trim() !== "..."; n++) block.push(lines[n] as string)
      yaml = parseTapYaml(block)
    }
    if (yaml["type"] === "suite") continue
    const parents = headers.slice(0, level).filter((h) => h !== undefined)
    const kind = directive?.[1]?.toLowerCase()
    const outcome: TestResult["result"] = kind === "skip" ? "skipped" : kind === "todo" ? (failed ? "skipped" : "passed") : failed ? "failed" : "passed"
    const said = typeof yaml["message"] === "string" ? yaml["message"] : typeof yaml["error"] === "string" ? yaml["error"] : ""
    const stack = typeof yaml["stack"] === "string" ? yaml["stack"] : ""
    const location = typeof yaml["location"] === "string" ? yaml["location"].replace(/:\d+:\d+$/, "") : undefined
    const message = outcome === "failed" ? cleanMessage([said, stack].filter(Boolean).join("\n")) : undefined
    const at = file ?? location
    out.push(result({
      name: [...parents, description].join(" > "),
      ...(at ? { file: at } : {}),
      result: outcome,
      ...(secondsOf(yaml["duration_ms"], 1000) !== undefined ? { seconds: secondsOf(yaml["duration_ms"], 1000) as number } : {}),
      ...(message ? { message } : {}),
    }))
  }
  return sawPlanOrPoint ? out : { error: "no TAP in the output: no version line, plan or test point" }
}

// ── libtest JSON ─────────────────────────────────────────────────────────────

/**
 * Every test event of Rust's libtest JSON lines (`--format json`): `ok` passed, `failed` and `timeout` failed,
 * `ignored` skipped; `exec_time` is its duration, `stdout` or `message` what it said. Lines that are not JSON (cargo's
 * own) are passed over.
 */
export function parseLibtest(text: string): TestResult[] | { error: string } {
  const out: TestResult[] = []
  let sawSuite = false
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t.startsWith("{")) continue
    let e: Record<string, unknown>
    try {
      const v = JSON.parse(t)
      if (!v || typeof v !== "object" || Array.isArray(v)) continue
      e = v as Record<string, unknown>
    } catch {
      continue
    }
    if (e["type"] === "suite") sawSuite = true
    if (e["type"] !== "test" || typeof e["name"] !== "string") continue
    const event = e["event"]
    const outcome = event === "ok" ? "passed" : event === "failed" || event === "timeout" ? "failed" : event === "ignored" ? "skipped" : null
    if (!outcome) continue
    const said = [e["message"], e["stdout"]].filter((x): x is string => typeof x === "string").join("\n")
    const message = outcome === "failed" ? cleanMessage(said || (event === "timeout" ? "timed out" : "")) : undefined
    out.push(result({
      name: e["name"],
      result: outcome,
      ...(secondsOf(e["exec_time"]) !== undefined ? { seconds: secondsOf(e["exec_time"]) as number } : {}),
      ...(message ? { message } : {}),
    }))
  }
  return sawSuite || out.length ? out : { error: "no libtest JSON in the output: run the tests with -Z unstable-options --format json" }
}

/** The formats the program ships. */
export const builtinFormats: TestFormat[] = [
  {
    id: "junit",
    says:
      "JUnit XML, from a file (`report`) or the output: pytest --junit-xml, deno test --reporter=junit, node --test-reporter=junit, bun test --reporter=junit, and most CI tools",
    parse: parseJunit,
  },
  { id: "tap", says: "TAP 13 or 14, with indented subtests and YAML diagnostics: deno test --reporter=tap, node --test-reporter=tap", parse: parseTap },
  { id: "libtest-json", says: "the JSON lines of Rust's test harness, cargo test -- -Z unstable-options --format json", parse: parseLibtest },
]
