// Markdown files with a short header: the front matter between two `---`
// lines, then the body: change notes, and the files a plugin's folder holds
// for a point that reads its contributions from files.
//
// The front matter is a strict subset of YAML, parsed line by line with no
// package: a field per line, `name: value`, or `name:` followed by
// `  - value` lines; a name is letters, starting with a lower-case one; a
// value is plain text, or a double-quoted JSON string, or a single-quoted YAML
// one. Every value is text. Anything else YAML allows (nested maps, flow lists,
// block scalars, anchors, tags, a plain value YAML would read otherwise, such
// as one holding ": " or " #" or starting with a quote or an indicator) is
// refused with the line it is on, so every file is also valid YAML with the
// same meaning.

/** One scalar of the subset: plain, double-quoted (JSON) or single-quoted. */
function scalar(raw: string, where: string): string {
  const v = raw.trim()
  if (v.startsWith('"')) {
    try {
      const s = JSON.parse(v) as unknown
      if (typeof s === "string") return s
    } catch {
      // refused below
    }
    throw new Error(`${where}: ${v} is not a double-quoted string`)
  }
  if (v.startsWith("'")) {
    if (v.length < 2 || !v.endsWith("'") || v.slice(1, -1).replace(/''/g, "").includes("'")) throw new Error(`${where}: ${v} is not a single-quoted string`)
    return v.slice(1, -1).replace(/''/g, "'")
  }
  if (v.includes(": ") || v.includes(" #") || v.endsWith(":") || /^[-?:,[\]{}#&*!|>%@`]/.test(v)) {
    throw new Error(`${where}: quote it — ${JSON.stringify(v)} is not plain text YAML reads the same way`)
  }
  return v
}

/** The front matter of `text`, as fields, and the text after it, trimmed. */
export function parseFrontMatter(text: string): { fields: Map<string, string | string[]>; body: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  if (lines[0] !== "---") throw new Error("no front matter: the file starts with a line ---")
  const end = lines.indexOf("---", 1)
  if (end === -1) throw new Error("the front matter is not closed by a line ---")
  const fields = new Map<string, string | string[]>()
  let list: string[] | null = null
  for (let i = 1; i < end; i++) {
    const line = lines[i] ?? ""
    const where = `line ${i + 1}`
    if (!line.trim()) continue
    if (line.startsWith("  - ")) {
      if (!list) throw new Error(`${where}: a list entry belongs under a field that has no value on its own line`)
      list.push(scalar(line.slice(4), where))
      continue
    }
    const colon = line.indexOf(":")
    const name = colon > 0 ? line.slice(0, colon) : ""
    if (!/^[a-z][a-zA-Z]*$/.test(name)) throw new Error(`${where}: expected "name: value", "name:" or "  - value"`)
    if (fields.has(name)) throw new Error(`${where}: ${name} is given twice`)
    const rest = line.slice(colon + 1)
    if (!rest.trim()) {
      list = []
      fields.set(name, list)
    } else {
      if (!rest.startsWith(" ")) throw new Error(`${where}: a space follows the colon`)
      list = null
      fields.set(name, scalar(rest, where))
    }
  }
  return { fields, body: lines.slice(end + 1).join("\n").trim() }
}

/** An ATX heading's level and text, or null: up to three spaces, one to six `#`, then a space or the end of the line. */
function heading(line: string): { level: number; text: string } | null {
  const indent = line.length - line.trimStart().length
  if (indent > 3) return null
  const t = line.trimStart()
  let level = 0
  while (t[level] === "#") level++
  if (level < 1 || level > 6 || (t.length > level && t[level] !== " " && t[level] !== "\t")) return null
  return { level, text: t.slice(level).trim().replace(/\s+#+$/, "").trim() }
}

/** A code fence's marker, three or more backticks or tildes at most three spaces in, or null. */
function fence(line: string): string | null {
  const indent = line.length - line.trimStart().length
  if (indent > 3) return null
  const t = line.trimStart()
  const ch = t[0]
  if (ch !== "`" && ch !== "~") return null
  let n = 0
  while (t[n] === ch) n++
  return n >= 3 ? ch.repeat(n) : null
}

/**
 * A Markdown body cut at its second-level headings: the text before the first one (`lead`), then each section by its
 * heading, in order. A heading inside a fenced code block is text; a deeper heading stays inside its section.
 */
export function sectionsOf(body: string): { lead: string; sections: { heading: string; text: string }[] } {
  const lead: string[] = []
  const sections: { heading: string; lines: string[] }[] = []
  let open: string | null = null
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const f = fence(line)
    if (open) {
      if (f && f[0] === open[0] && f.length >= open.length && line.trim() === f) open = null
    } else if (f) {
      open = f
    } else {
      const h = heading(line)
      if (h && h.level === 2) {
        sections.push({ heading: h.text, lines: [] })
        continue
      }
    }
    ;(sections.at(-1)?.lines ?? lead).push(line)
  }
  return { lead: lead.join("\n").trim(), sections: sections.map((s) => ({ heading: s.heading, text: s.lines.join("\n").trim() })) }
}

/** Whether a line starts a block of its own rather than continuing a paragraph: a heading, a list item, a quote, a table row. */
const startsBlock = (line: string): boolean => {
  const t = line.trimStart()
  return heading(line) !== null || /^([-*+]|\d+[.)])(\s|$)/.test(t) || t.startsWith(">") || t.startsWith("|")
}

/**
 * Markdown text with each paragraph on one line, as Markdown reads it: the lines of a paragraph, or of a list item and
 * its indented continuation, are joined by a space. Blank lines, fenced code blocks and the lines that start a block
 * are kept as they are, so a file wrapped by a formatter reads the same as one written a paragraph per line.
 */
export function unwrapped(text: string): string {
  const out: string[] = []
  let open: string | null = null
  let joinable = false
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const f = fence(line)
    if (open) {
      if (f && f[0] === open[0] && f.length >= open.length && line.trim() === f) open = null
      out.push(line)
      joinable = false
      continue
    }
    if (f) {
      open = f
      out.push(line)
      joinable = false
      continue
    }
    if (!line.trim()) {
      out.push("")
      joinable = false
      continue
    }
    if (joinable && !startsBlock(line)) {
      out[out.length - 1] = `${out[out.length - 1]} ${line.trim()}`
      continue
    }
    out.push(heading(line) ? line : line.trimEnd())
    joinable = heading(line) === null
  }
  return out.join("\n")
}
