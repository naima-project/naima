// A CommonMark parser, as far as links, anchors and code blocks need it.
//
// It follows the CommonMark specification, version 0.31.2
// (https://spec.commonmark.org/0.31.2/), and its two-phase parsing strategy:
// first the block structure, line by line — containers (block quotes, lists,
// list items) and leaves (paragraphs, ATX and setext headings, fenced and
// indented code, HTML blocks, thematic breaks, link reference definitions) —
// then the inline content of paragraphs and headings: backslash escapes, code
// spans, autolinks, raw HTML, links and images (inline, full, collapsed and
// shortcut references, nested brackets) and emphasis by the delimiter-run
// algorithm. The structure of the algorithm is the reference implementation's,
// commonmark.js.
//
// What it returns is what a link check needs: every link and image destination
// with its line, every heading's plain text, every anchor an HTML `id` (or an
// `<a name>`) declares; and, for a page whose examples are checked, every code
// block with its info word and text. Regular expressions appear only where the
// specification itself defines a token by a regular pattern (a list marker, a
// fence, an HTML tag, an entity), never to find structure.
//
// Known limits, deliberate: tabs are expanded to tab stops of 4 before the
// block phase (the specification's partial-tab rules matter only to code-block
// content, which no link lives in); of the named character references only the
// five XML ones are decoded; GitHub-flavoured extensions (tables, strikethrough,
// autolink literals) are read as CommonMark reads them, which keeps every link
// inside a table cell visible.

/** A link or image destination, and the 1-based line where its link starts; a reference link's, once, on its definition's line. */
export interface MarkdownLink {
  target: string
  line: number
}

/** A heading's plain text, as a renderer shows it, and its 1-based line. */
export interface MarkdownHeading {
  text: string
  line: number
}

/** A code block: a fenced block's info word (`mcrl2` for "```mcrl2"), empty for none or an indented block; its text; its 1-based first line. */
export interface MarkdownCode {
  info: string
  text: string
  line: number
}

export interface ParsedMarkdown {
  links: MarkdownLink[]
  headings: MarkdownHeading[]
  /** Anchors declared in HTML: every `id` attribute, and `name` on `<a>`. */
  htmlAnchors: string[]
  /** Every code block, fenced or indented, in the order of the document. */
  code: MarkdownCode[]
}

// ── tokens the specification defines by a regular pattern ──────────────────

const ESCAPABLE = "[!\"#$%&'()*+,./:;<=>?@[\\\\\\]^_`{|}~-]"
const TAGNAME = "[A-Za-z][A-Za-z0-9-]*"
const ATTRIBUTENAME = "[a-zA-Z_:][a-zA-Z0-9_.:-]*"
const UNQUOTEDVALUE = "[^\"'=<>`\\x00-\\x20]+"
const ATTRIBUTEVALUE = `(?:${UNQUOTEDVALUE}|'[^']*'|"[^"]*")`
const ATTRIBUTE = `(?:\\s+${ATTRIBUTENAME}(?:\\s*=\\s*${ATTRIBUTEVALUE})?)`
const OPENTAG = `<${TAGNAME}${ATTRIBUTE}*\\s*/?>`
const CLOSETAG = `</${TAGNAME}\\s*>`
const HTMLCOMMENT = "<!-->|<!--->|<!--[\\s\\S]*?-->"
const PROCESSING = "<[?][\\s\\S]*?[?]>"
const DECLARATION = "<![A-Za-z][^>]*>"
const CDATA = "<!\\[CDATA\\[[\\s\\S]*?\\]\\]>"
const HTMLTAG = new RegExp(`^(?:${OPENTAG}|${CLOSETAG}|${HTMLCOMMENT}|${PROCESSING}|${DECLARATION}|${CDATA})`, "i")

const HTML_BLOCK_OPEN: RegExp[] = [
  /./, // index 0 unused: the block types are 1-7
  /^<(?:script|pre|textarea|style)(?:\s|>|$)/i,
  /^<!--/,
  /^<[?]/,
  /^<![A-Za-z]/,
  /^<!\[CDATA\[/,
  /^<[/]?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[123456]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|[/]?[>]|$)/i,
  new RegExp(`^(?:${OPENTAG}|${CLOSETAG})\\s*$`, "i"),
]
const HTML_BLOCK_CLOSE: RegExp[] = [/./, /<\/(?:script|pre|textarea|style)>/i, /-->/, /\?>/, />/, /\]\]>/]

const ATX_OPEN = /^#{1,6}(?:[ \t]+|$)/
const FENCE_OPEN = /^`{3,}(?!.*`)|^~{3,}/
const FENCE_CLOSE = /^(?:`{3,}|~{3,})(?=[ \t]*$)/
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/
const THEMATIC_BREAK = /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/
const BULLET = /^[*+-]/
const ORDERED = /^(\d{1,9})([.)])/
// deno-lint-ignore no-control-regex -- CommonMark excludes the ASCII control characters here
const AUTOLINK_URI = /^<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]*>/
const AUTOLINK_EMAIL = /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/
const ENTITY = /^&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/
const ESCAPED_CHAR = new RegExp(`^\\\\(${ESCAPABLE})`)
const PUNCTUATION = /[\p{P}\p{S}]/u
const UNICODE_SPACE = /\s/u

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }

/** A character reference, decoded: numeric ones always, named ones when they are XML's five. */
function decodeEntity(ref: string): string {
  const body = ref.slice(1, -1)
  if (body[0] === "#") {
    const n = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    return n === 0 || n > 0x10ffff ? "�" : String.fromCodePoint(n)
  }
  return XML_ENTITIES[body] ?? ref
}

/** Backslash escapes and character references resolved, as in a destination, a title or a label. */
function unescapeString(s: string): string {
  let out = ""
  for (let i = 0; i < s.length;) {
    const ch = s[i] ?? ""
    if (ch === "\\" && ESCAPED_CHAR.test(s.slice(i))) {
      out += s[i + 1]
      i += 2
    } else if (ch === "&") {
      const m = s.slice(i).match(ENTITY)
      if (m) {
        out += decodeEntity(m[0])
        i += m[0].length
      } else {
        out += ch
        i++
      }
    } else {
      out += ch
      i++
    }
  }
  return out
}

/** A link label normalized for matching: whitespace collapsed, case folded. */
function normalizeLabel(label: string): string {
  return label.slice(1, -1).trim().split(/[ \t\r\n]+/).join(" ").toLowerCase().toUpperCase()
}

/** A line with its tabs expanded to the next multiple of four columns. */
function expandTabs(line: string): string {
  if (!line.includes("\t")) return line
  let out = ""
  for (const ch of line) out += ch === "\t" ? " ".repeat(4 - (out.length % 4)) : ch
  return out
}

// ── HTML: the anchors a fragment declares ───────────────────────────────────

/**
 * The anchors in an HTML fragment: every `id` attribute, and `name` on `<a>`.
 * A tokenizer over tags and their attributes, skipping comments; text between
 * tags is not read.
 */
export function htmlAnchorsOf(html: string): string[] {
  const out: string[] = []
  let i = 0
  while ((i = html.indexOf("<", i)) !== -1) {
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4)
      i = end === -1 ? html.length : end + 3
      continue
    }
    const tag = html.slice(i).match(new RegExp(`^${OPENTAG}`))
    if (!tag) {
      i++
      continue
    }
    const text = tag[0]
    const name = (text.match(new RegExp(`^<(${TAGNAME})`))?.[1] ?? "").toLowerCase()
    for (const a of text.matchAll(new RegExp(`\\s+(${ATTRIBUTENAME})(?:\\s*=\\s*(${ATTRIBUTEVALUE}))?`, "g"))) {
      const attr = (a[1] ?? "").toLowerCase()
      const raw = a[2] ?? ""
      const value = raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw
      if (value && (attr === "id" || (attr === "name" && name === "a"))) out.push(unescapeString(value))
    }
    i += text.length
  }
  return out
}

// ── the tree ────────────────────────────────────────────────────────────────

type BlockType = "document" | "block_quote" | "list" | "item" | "paragraph" | "heading" | "code_block" | "html_block" | "thematic_break"
type InlineType = "text" | "softbreak" | "linebreak" | "code" | "html_inline" | "emph" | "strong" | "link" | "image"

class MdNode {
  parent: MdNode | null = null
  firstChild: MdNode | null = null
  lastChild: MdNode | null = null
  prev: MdNode | null = null
  next: MdNode | null = null
  open = true
  lastLineBlank = false
  /** Content lines of a leaf, each with its source line. */
  lines: { text: string; line: number }[] = []
  literal = ""
  startLine = 0
  // code blocks
  fenced = false
  fenceChar = ""
  fenceLength = 0
  fenceOffset = 0
  // HTML blocks
  htmlBlockType = 0
  // lists and items
  listType: "bullet" | "ordered" = "bullet"
  bulletChar = ""
  delimiter = ""
  markerOffset = 0
  padding = 0
  // headings
  level = 0
  type: BlockType | InlineType
  constructor(type: BlockType | InlineType) {
    this.type = type
  }

  appendChild(child: MdNode): void {
    child.unlink()
    child.parent = this
    if (this.lastChild) {
      this.lastChild.next = child
      child.prev = this.lastChild
      this.lastChild = child
    } else {
      this.firstChild = child
      this.lastChild = child
    }
  }

  insertAfter(sibling: MdNode): void {
    sibling.unlink()
    sibling.next = this.next
    if (sibling.next) sibling.next.prev = sibling
    sibling.prev = this
    this.next = sibling
    sibling.parent = this.parent
    if (!sibling.next && sibling.parent) sibling.parent.lastChild = sibling
  }

  unlink(): void {
    if (this.prev) this.prev.next = this.next
    else if (this.parent) this.parent.firstChild = this.next
    if (this.next) this.next.prev = this.prev
    else if (this.parent) this.parent.lastChild = this.prev
    this.parent = this.next = this.prev = null
  }
}

const isContainer = (t: string): boolean => t === "document" || t === "block_quote" || t === "list" || t === "item"
const canContain = (parent: string, child: string): boolean =>
  parent === "list" ? child === "item" : (parent === "document" || parent === "block_quote" || parent === "item") && child !== "item"
const acceptsLines = (t: string): boolean => t === "paragraph" || t === "code_block" || t === "html_block"

// ── inline: links, code spans, raw HTML, emphasis ───────────────────────────

interface Delimiter {
  cc: string
  numdelims: number
  origdelims: number
  node: MdNode
  previous: Delimiter | null
  next: Delimiter | null
  canOpen: boolean
  canClose: boolean
}

interface Bracket {
  node: MdNode
  previous: Bracket | null
  previousDelimiter: Delimiter | null
  index: number
  image: boolean
  active: boolean
  bracketAfter: boolean
}

class InlineParser {
  private subject = ""
  private pos = 0
  private delimiters: Delimiter | null = null
  private brackets: Bracket | null = null
  private lineOf: (offset: number) => number = () => 0

  private refmap: Map<string, string>
  private links: MarkdownLink[]
  private anchors: string[]
  constructor(refmap: Map<string, string>, links: MarkdownLink[], anchors: string[]) {
    this.refmap = refmap
    this.links = links
    this.anchors = anchors
  }

  /** Parse `content` (lines joined by \n) into children of `block`; `lineOf` maps an offset to its source line. */
  parse(block: MdNode, content: string, lineOf: (offset: number) => number): void {
    this.subject = content.trim()
    const lead = content.length - content.trimStart().length
    this.lineOf = (o) => lineOf(o + lead)
    this.pos = 0
    this.delimiters = null
    this.brackets = null
    while (this.parseInline(block));
    this.processEmphasis(null)
  }

  private peek(): string {
    return this.subject[this.pos] ?? ""
  }

  private match(re: RegExp): string | null {
    const m = this.subject.slice(this.pos).match(re)
    if (!m || m.index !== 0) return null
    this.pos += m[0].length
    return m[0]
  }

  private text(s: string): MdNode {
    const n = new MdNode("text")
    n.literal = s
    return n
  }

  private parseInline(block: MdNode): boolean {
    const c = this.peek()
    if (!c) return false
    let ok = false
    switch (c) {
      case "\n":
        ok = this.parseNewline(block)
        break
      case "\\":
        ok = this.parseBackslash(block)
        break
      case "`":
        ok = this.parseBackticks(block)
        break
      case "*":
      case "_":
        ok = this.handleDelim(c, block)
        break
      case "[":
        ok = this.parseOpenBracket(block)
        break
      case "!":
        ok = this.parseBang(block)
        break
      case "]":
        ok = this.parseCloseBracket(block)
        break
      case "<":
        ok = this.parseAutolink(block) || this.parseHtmlTag(block)
        break
      case "&":
        ok = this.parseEntity(block)
        break
      default:
        ok = this.parseString(block)
    }
    if (!ok) {
      this.pos++
      block.appendChild(this.text(c))
    }
    return true
  }

  private parseNewline(block: MdNode): boolean {
    this.pos++
    const last = block.lastChild
    if (last && last.type === "text" && last.literal.endsWith(" ")) {
      const hard = last.literal.endsWith("  ")
      last.literal = last.literal.replace(/ +$/, "")
      block.appendChild(new MdNode(hard ? "linebreak" : "softbreak"))
    } else block.appendChild(new MdNode("softbreak"))
    this.match(/^ */)
    return true
  }

  private parseBackslash(block: MdNode): boolean {
    this.pos++
    const c = this.peek()
    if (c === "\n") {
      this.pos++
      block.appendChild(new MdNode("linebreak"))
    } else if (c && new RegExp(`^${ESCAPABLE}$`).test(c)) {
      this.pos++
      block.appendChild(this.text(c))
    } else block.appendChild(this.text("\\"))
    return true
  }

  private parseBackticks(block: MdNode): boolean {
    const ticks = this.match(/^`+/) ?? ""
    const after = this.pos
    for (let i = after;;) {
      const j = this.subject.indexOf("`", i)
      if (j === -1) break
      let k = j
      while (this.subject[k] === "`") k++
      if (k - j === ticks.length) {
        let contents = this.subject.slice(after, j).replace(/\n/g, " ")
        if (/[^ ]/.test(contents) && contents[0] === " " && contents[contents.length - 1] === " ") contents = contents.slice(1, -1)
        const node = new MdNode("code")
        node.literal = contents
        block.appendChild(node)
        this.pos = k
        return true
      }
      i = k
    }
    this.pos = after
    block.appendChild(this.text(ticks))
    return true
  }

  private scanDelims(c: string): { numdelims: number; canOpen: boolean; canClose: boolean } {
    const start = this.pos
    let numdelims = 0
    while (this.subject[this.pos] === c) {
      numdelims++
      this.pos++
    }
    const before = start === 0 ? "\n" : this.subject[start - 1] ?? "\n"
    const after = this.subject[this.pos] ?? "\n"
    this.pos = start
    const afterSpace = UNICODE_SPACE.test(after), afterPunct = PUNCTUATION.test(after)
    const beforeSpace = UNICODE_SPACE.test(before), beforePunct = PUNCTUATION.test(before)
    const left = !afterSpace && (!afterPunct || beforeSpace || beforePunct)
    const right = !beforeSpace && (!beforePunct || afterSpace || afterPunct)
    if (c === "_") return { numdelims, canOpen: left && (!right || beforePunct), canClose: right && (!left || afterPunct) }
    return { numdelims, canOpen: left, canClose: right }
  }

  private handleDelim(c: string, block: MdNode): boolean {
    const { numdelims, canOpen, canClose } = this.scanDelims(c)
    if (numdelims < 1) return false
    const start = this.pos
    this.pos += numdelims
    const node = this.text(this.subject.slice(start, this.pos))
    block.appendChild(node)
    if (canOpen || canClose) {
      this.delimiters = { cc: c, numdelims, origdelims: numdelims, node, previous: this.delimiters, next: null, canOpen, canClose }
      if (this.delimiters.previous) this.delimiters.previous.next = this.delimiters
    }
    return true
  }

  private removeDelimiter(d: Delimiter): void {
    if (d.previous) d.previous.next = d.next
    if (d.next) d.next.previous = d.previous
    else this.delimiters = d.previous
  }

  private parseOpenBracket(block: MdNode): boolean {
    const start = this.pos
    this.pos++
    const node = this.text("[")
    block.appendChild(node)
    this.addBracket(node, start, false)
    return true
  }

  private parseBang(block: MdNode): boolean {
    const start = this.pos
    this.pos++
    if (this.peek() === "[") {
      this.pos++
      const node = this.text("![")
      block.appendChild(node)
      this.addBracket(node, start + 1, true)
    } else block.appendChild(this.text("!"))
    return true
  }

  private addBracket(node: MdNode, index: number, image: boolean): void {
    if (this.brackets) this.brackets.bracketAfter = true
    this.brackets = { node, previous: this.brackets, previousDelimiter: this.delimiters, index, image, active: true, bracketAfter: false }
  }

  private spnl(): void {
    this.match(/^ *(?:\n *)?/)
  }

  /** A link destination at the cursor: `<...>` or a run with balanced parentheses; null when there is none. */
  private parseDestination(): string | null {
    // deno-lint-ignore no-control-regex -- CommonMark excludes the ASCII control characters here
    const pointy = this.match(/^<(?:[^<>\n\\\x00]|\\.)*>/)
    if (pointy !== null) return unescapeString(pointy.slice(1, -1))
    if (this.peek() === "<") return null
    const save = this.pos
    let depth = 0
    for (;;) {
      const c = this.peek()
      if (c === "\\" && ESCAPED_CHAR.test(this.subject.slice(this.pos))) this.pos += 2
      else if (c === "(") {
        depth++
        this.pos++
        if (depth > 32) return null
      } else if (c === ")") {
        if (depth < 1) break
        depth--
        this.pos++
      } else if (!c || c.charCodeAt(0) <= 0x20) break
      else this.pos++
    }
    if (this.pos === save && this.peek() !== ")") return null
    if (depth !== 0) return null
    return unescapeString(this.subject.slice(save, this.pos))
  }

  private parseTitle(): string | null {
    // deno-lint-ignore no-control-regex -- CommonMark excludes the ASCII control characters here
    const t = this.match(/^(?:"(?:\\[\s\S]|[^"\\\x00])*"|'(?:\\[\s\S]|[^'\\\x00])*'|\((?:\\[\s\S]|[^()\\\x00])*\))/)
    return t === null ? null : unescapeString(t.slice(1, -1))
  }

  /** A link label `[...]` at the cursor, returning its length; 0 when there is none. */
  private parseLabel(): number {
    const m = this.match(/^\[(?:[^\\\[\]]|\\.){0,999}\]/s)
    return m === null || m.length > 1001 ? 0 : m.length
  }

  private parseCloseBracket(block: MdNode): boolean {
    const startpos = this.pos
    this.pos++
    const opener = this.brackets
    if (!opener) {
      block.appendChild(this.text("]"))
      return true
    }
    if (!opener.active) {
      block.appendChild(this.text("]"))
      this.brackets = opener.previous
      return true
    }
    let dest: string | null = null
    let matched = false
    let inline = false
    const savepos = this.pos
    if (this.peek() === "(") {
      this.pos++
      this.spnl()
      dest = this.parseDestination()
      if (dest !== null) {
        this.spnl()
        const ws = this.pos > 0 && /[ \t\n]/.test(this.subject[this.pos - 1] ?? "")
        if (ws) this.parseTitle()
        this.spnl()
        if (this.peek() === ")") {
          this.pos++
          matched = true
          inline = true
        }
      }
      if (!matched) this.pos = savepos
    }
    if (!matched) {
      const beforeLabel = this.pos
      const n = this.parseLabel()
      let ref: string | null = null
      if (n > 2) ref = this.subject.slice(beforeLabel, beforeLabel + n)
      else if (!opener.bracketAfter) ref = this.subject.slice(opener.index, startpos + 1)
      if (n === 0) this.pos = savepos
      if (ref !== null) {
        const found = this.refmap.get(normalizeLabel(ref))
        if (found !== undefined) {
          dest = found
          matched = true
        }
      }
      if (!matched) this.pos = savepos
    }
    if (!matched) {
      this.brackets = opener.previous
      block.appendChild(this.text("]"))
      return true
    }
    const node = new MdNode(opener.image ? "image" : "link")
    node.literal = dest ?? ""
    // a reference link's target is reported once, where it is defined
    if (inline) this.links.push({ target: dest ?? "", line: this.lineOf(opener.index) })
    let tmp = opener.node.next
    while (tmp) {
      const next = tmp.next
      node.appendChild(tmp)
      tmp = next
    }
    block.appendChild(node)
    this.processEmphasis(opener.previousDelimiter)
    this.brackets = opener.previous
    opener.node.unlink()
    if (!opener.image) {
      for (let b = this.brackets; b; b = b.previous) if (!b.image) b.active = false
    }
    return true
  }

  private parseAutolink(block: MdNode): boolean {
    const start = this.pos
    const email = this.match(AUTOLINK_EMAIL)
    const uri = email === null ? this.match(AUTOLINK_URI) : null
    const m = email ?? uri
    if (m === null) return false
    const dest = email !== null ? "mailto:" + m.slice(1, -1) : m.slice(1, -1)
    const node = new MdNode("link")
    node.literal = dest
    node.appendChild(this.text(m.slice(1, -1)))
    block.appendChild(node)
    this.links.push({ target: dest, line: this.lineOf(start) })
    return true
  }

  private parseHtmlTag(block: MdNode): boolean {
    const m = this.match(HTMLTAG)
    if (m === null) return false
    const node = new MdNode("html_inline")
    node.literal = m
    block.appendChild(node)
    this.anchors.push(...htmlAnchorsOf(m))
    return true
  }

  private parseEntity(block: MdNode): boolean {
    const m = this.match(ENTITY)
    if (m === null) return false
    block.appendChild(this.text(decodeEntity(m)))
    return true
  }

  private parseString(block: MdNode): boolean {
    const m = this.match(/^[^\n`\[\]\\!<&*_]+/)
    if (m === null) return false
    block.appendChild(this.text(m))
    return true
  }

  /** The delimiter-run algorithm: pair `*` and `_` runs above `stackBottom` into emphasis and strong emphasis. */
  private processEmphasis(stackBottom: Delimiter | null): void {
    const openersBottom = new Map<string, Delimiter | null>()
    const key = (d: Delimiter) => `${d.cc}${d.canOpen ? 3 : 0}${d.origdelims % 3}`
    let closer = this.delimiters
    while (closer && closer.previous !== stackBottom) closer = closer.previous
    while (closer) {
      if (!closer.canClose) {
        closer = closer.next
        continue
      }
      let opener = closer.previous
      let found = false
      const bottom = openersBottom.get(key(closer)) ?? stackBottom
      while (opener && opener !== stackBottom && opener !== bottom) {
        const odd = (closer.canOpen || opener.canClose) && closer.origdelims % 3 !== 0 && (opener.origdelims + closer.origdelims) % 3 === 0
        if (opener.cc === closer.cc && opener.canOpen && !odd) {
          found = true
          break
        }
        opener = opener.previous
      }
      const oldCloser = closer
      if (found && opener) {
        const use = closer.numdelims >= 2 && opener.numdelims >= 2 ? 2 : 1
        opener.numdelims -= use
        closer.numdelims -= use
        opener.node.literal = opener.node.literal.slice(0, opener.node.literal.length - use)
        closer.node.literal = closer.node.literal.slice(0, closer.node.literal.length - use)
        const emph = new MdNode(use === 1 ? "emph" : "strong")
        let tmp = opener.node.next
        while (tmp && tmp !== closer.node) {
          const next = tmp.next
          emph.appendChild(tmp)
          tmp = next
        }
        opener.node.insertAfter(emph)
        for (let d = closer.previous; d && d !== opener;) {
          const prev = d.previous
          this.removeDelimiter(d)
          d = prev
        }
        if (opener.numdelims === 0) {
          opener.node.unlink()
          this.removeDelimiter(opener)
        }
        if (closer.numdelims === 0) {
          closer.node.unlink()
          const next = closer.next
          this.removeDelimiter(closer)
          closer = next
        }
      } else {
        closer = closer.next
        openersBottom.set(key(oldCloser), oldCloser.previous)
        if (!oldCloser.canOpen) this.removeDelimiter(oldCloser)
      }
    }
    while (this.delimiters && this.delimiters !== stackBottom) this.removeDelimiter(this.delimiters)
  }
}

/** The plain text of an inline tree, as a renderer shows it: HTML left out, code and link text kept. */
function plainText(node: MdNode): string {
  let out = ""
  for (let c = node.firstChild; c; c = c.next) {
    if (c.type === "text" || c.type === "code") out += c.literal
    else if (c.type === "softbreak" || c.type === "linebreak") out += " "
    else if (c.type !== "html_inline") out += plainText(c)
  }
  return out
}

// ── link reference definitions ──────────────────────────────────────────────

/**
 * Remove the link reference definitions at the start of a paragraph's content,
 * recording each (first definition wins) and its destination as a link; return
 * what is left of the content.
 */
function extractReferences(p: InlineParserForRefs, content: string, refmap: Map<string, string>, lineOf: (o: number) => number, links: MarkdownLink[]): string {
  let rest = content
  let consumed = 0
  for (;;) {
    const n = p.parseReference(rest, refmap, (o) => lineOf(o + consumed), links)
    if (n === 0) break
    rest = rest.slice(n)
    consumed += n
  }
  return rest
}

/** The part of the inline grammar a reference definition uses: label, destination, title. */
class InlineParserForRefs {
  private s = ""
  private pos = 0

  private match(re: RegExp): string | null {
    const m = this.s.slice(this.pos).match(re)
    if (!m || m.index !== 0) return null
    this.pos += m[0].length
    return m[0]
  }

  /** Parse one definition at the start of `s`; return its length, or 0 when there is none. */
  parseReference(s: string, refmap: Map<string, string>, lineOf: (o: number) => number, links: MarkdownLink[]): number {
    this.s = s
    this.pos = 0
    const start = this.pos
    const label = this.match(/^\[(?:[^\\\[\]]|\\.){0,999}\]/s)
    if (label === null || !/[^ \t\r\n]/.test(label.slice(1, -1))) return 0
    if (this.s[this.pos] !== ":") return 0
    this.pos++
    this.match(/^[ \t]*(?:\n[ \t]*)?/)
    const destStart = this.pos
    let dest: string | null = null
    // deno-lint-ignore no-control-regex -- CommonMark excludes the ASCII control characters here
    const pointy = this.match(/^<(?:[^<>\n\\\x00]|\\.)*>/)
    if (pointy !== null) dest = unescapeString(pointy.slice(1, -1))
    else {
      let depth = 0
      const save = this.pos
      for (;;) {
        const c = this.s[this.pos] ?? ""
        if (c === "\\" && ESCAPED_CHAR.test(this.s.slice(this.pos))) this.pos += 2
        else if (c === "(") {
          depth++
          this.pos++
        } else if (c === ")") {
          if (depth < 1) break
          depth--
          this.pos++
        } else if (!c || c.charCodeAt(0) <= 0x20) break
        else this.pos++
      }
      if (this.pos > save && depth === 0) dest = unescapeString(this.s.slice(save, this.pos))
    }
    if (dest === null) return 0
    const beforeTitle = this.pos
    this.match(/^[ \t]*(?:\n[ \t]*)?/)
    const sawSpace = this.pos > beforeTitle
    // deno-lint-ignore no-control-regex -- CommonMark excludes the ASCII control characters here
    const title = sawSpace ? this.match(/^(?:"(?:\\[\s\S]|[^"\\\x00])*"|'(?:\\[\s\S]|[^'\\\x00])*'|\((?:\\[\s\S]|[^()\\\x00])*\))/) : null
    if (title === null) this.pos = beforeTitle
    let atLineEnd = this.match(/^[ \t]*(?:\n|$)/) !== null
    if (!atLineEnd) {
      if (title === null) return 0
      this.pos = beforeTitle // a title followed by more text: the definition ends at the destination
      atLineEnd = this.match(/^[ \t]*(?:\n|$)/) !== null
      if (!atLineEnd) return 0
    }
    const key = normalizeLabel(label)
    if (key === "") return 0
    if (!refmap.has(key)) refmap.set(key, dest)
    links.push({ target: dest, line: lineOf(destStart) })
    return this.pos - start
  }
}

// ── blocks ──────────────────────────────────────────────────────────────────

class BlockParser {
  private doc = new MdNode("document")
  private tip: MdNode = this.doc
  private oldtip: MdNode = this.doc
  private lastMatchedContainer: MdNode = this.doc
  private line = ""
  private lineNumber = 0
  private offset = 0
  private nextNonspace = 0
  private indent = 0
  private indented = false
  private blank = false
  private allClosed = true
  private refmap = new Map<string, string>()
  private links: MarkdownLink[] = []
  private anchors: string[] = []
  private headings: MarkdownHeading[] = []
  private code: MarkdownCode[] = []

  parse(input: string): ParsedMarkdown {
    const lines = input.replace(/\r\n?/g, "\n").split("\n")
    if (lines[lines.length - 1] === "") lines.pop()
    for (const l of lines) {
      this.lineNumber++
      this.incorporateLine(expandTabs(l))
    }
    while (this.tip !== this.doc) this.finalize(this.tip)
    this.finalize(this.doc)
    this.processInlines()
    return {
      links: this.links.sort((a, b) => a.line - b.line),
      headings: this.headings,
      htmlAnchors: this.anchors,
      code: this.code.sort((a, b) => a.line - b.line),
    }
  }

  private findNextNonspace(): void {
    let i = this.offset
    while (this.line[i] === " ") i++
    this.blank = i >= this.line.length
    this.nextNonspace = i
    this.indent = i - this.offset
    this.indented = this.indent >= 4
  }

  private advanceNextNonspace(): void {
    this.offset = this.nextNonspace
  }

  private advanceOffset(count: number): void {
    this.offset = Math.min(this.line.length, this.offset + count)
  }

  private peekAt(i: number): string {
    return this.line[i] ?? ""
  }

  private rest(): string {
    return this.line.slice(this.nextNonspace)
  }

  private addLine(): void {
    this.tip.lines.push({ text: this.line.slice(this.offset), line: this.lineNumber })
  }

  private addChild(type: BlockType, offset: number): MdNode {
    while (!canContain(this.tip.type, type)) this.finalize(this.tip)
    const node = new MdNode(type)
    node.startLine = this.lineNumber
    node.markerOffset = offset
    this.tip.appendChild(node)
    this.tip = node
    return node
  }

  private closeUnmatchedBlocks(): void {
    if (!this.allClosed) {
      while (this.oldtip !== this.lastMatchedContainer) {
        const parent = this.oldtip.parent
        this.finalize(this.oldtip)
        if (!parent) break
        this.oldtip = parent
      }
      this.allClosed = true
    }
  }

  /** 0: the container continues; 1: it does not; 2: the line is consumed (a closing fence). */
  private continues(c: MdNode): 0 | 1 | 2 {
    switch (c.type) {
      case "document":
      case "list":
        return 0
      case "block_quote":
        if (!this.indented && this.peekAt(this.nextNonspace) === ">") {
          this.advanceNextNonspace()
          this.advanceOffset(1)
          if (this.peekAt(this.offset) === " ") this.advanceOffset(1)
          return 0
        }
        return 1
      case "item":
        if (this.blank) {
          if (c.firstChild === null) return 1
          this.advanceNextNonspace()
          return 0
        }
        if (this.indent >= c.markerOffset + c.padding) {
          this.advanceOffset(c.markerOffset + c.padding)
          return 0
        }
        return 1
      case "heading":
      case "thematic_break":
        return 1
      case "code_block":
        if (c.fenced) {
          const m = this.indent <= 3 && this.peekAt(this.nextNonspace) === c.fenceChar ? this.rest().match(FENCE_CLOSE) : null
          if (m && m[0].length >= c.fenceLength) {
            this.finalize(c)
            return 2
          }
          let i = c.fenceOffset
          while (i > 0 && this.peekAt(this.offset) === " ") {
            this.advanceOffset(1)
            i--
          }
          return 0
        }
        if (this.indent >= 4) {
          this.advanceOffset(4)
          return 0
        }
        if (this.blank) {
          this.advanceNextNonspace()
          return 0
        }
        return 1
      case "html_block":
        return this.blank && (c.htmlBlockType === 6 || c.htmlBlockType === 7) ? 1 : 0
      case "paragraph":
        return this.blank ? 1 : 0
      default:
        return 1
    }
  }

  /** The block starts, in the specification's order: 0 none, 1 a container, 2 a leaf. */
  private blockStart(container: MdNode): 0 | 1 | 2 {
    const c = this.peekAt(this.nextNonspace)
    // block quote
    if (!this.indented && c === ">") {
      this.advanceNextNonspace()
      this.advanceOffset(1)
      if (this.peekAt(this.offset) === " ") this.advanceOffset(1)
      this.closeUnmatchedBlocks()
      this.addChild("block_quote", this.nextNonspace)
      return 1
    }
    // ATX heading
    const atx = !this.indented ? this.rest().match(ATX_OPEN) : null
    if (atx) {
      this.advanceNextNonspace()
      this.advanceOffset(atx[0].length)
      this.closeUnmatchedBlocks()
      const h = this.addChild("heading", this.nextNonspace)
      h.level = atx[0].trim().length
      const text = this.line.slice(this.offset).replace(/^[ \t]*#+[ \t]*$/, "").replace(/[ \t]+#+[ \t]*$/, "")
      h.lines = [{ text, line: this.lineNumber }]
      this.advanceOffset(this.line.length - this.offset)
      return 2
    }
    // fenced code
    const fence = !this.indented ? this.rest().match(FENCE_OPEN) : null
    if (fence) {
      this.closeUnmatchedBlocks()
      const f = this.addChild("code_block", this.nextNonspace)
      f.fenced = true
      f.fenceChar = fence[0][0] ?? "`"
      f.fenceLength = fence[0].length
      f.fenceOffset = this.indent
      this.advanceNextNonspace()
      this.advanceOffset(fence[0].length)
      return 2
    }
    // HTML block
    if (!this.indented && c === "<") {
      const s = this.rest()
      for (let t = 1; t <= 7; t++) {
        const re = HTML_BLOCK_OPEN[t]
        if (re && re.test(s) && (t < 7 || (container.type !== "paragraph" && !(!this.allClosed && !this.blank && this.tip.type === "paragraph")))) {
          this.closeUnmatchedBlocks()
          const b = this.addChild("html_block", this.offset)
          b.htmlBlockType = t
          return 2
        }
      }
    }
    // setext heading
    if (!this.indented && container.type === "paragraph" && SETEXT_UNDERLINE.test(this.rest())) {
      this.closeUnmatchedBlocks()
      const content = extractReferences(
        new InlineParserForRefs(),
        container.lines.map((l) => l.text).join("\n"),
        this.refmap,
        lineMapper(container.lines),
        this.links,
      )
      if (content.trim()) {
        const h = new MdNode("heading")
        h.level = this.rest()[0] === "=" ? 1 : 2
        h.startLine = container.startLine
        const kept = container.lines.length - content.split("\n").length
        h.lines = container.lines.slice(kept)
        if (h.lines[0]) h.lines[0] = { ...h.lines[0], text: content.split("\n")[0] ?? "" }
        container.insertAfter(h)
        container.unlink()
        this.tip = h
        this.advanceOffset(this.line.length - this.offset)
        return 2
      }
      container.lines = []
    }
    // thematic break
    if (!this.indented && THEMATIC_BREAK.test(this.rest())) {
      this.closeUnmatchedBlocks()
      this.addChild("thematic_break", this.nextNonspace)
      this.advanceOffset(this.line.length - this.offset)
      return 2
    }
    // list item
    if (!this.indented || container.type === "list") {
      const item = this.parseListMarker(container)
      if (item) {
        this.closeUnmatchedBlocks()
        if (this.tip.type !== "list" || !sameList(container, item)) {
          const list = this.addChild("list", this.nextNonspace)
          list.listType = item.listType
          list.bulletChar = item.bulletChar
          list.delimiter = item.delimiter
        }
        const it = this.addChild("item", this.nextNonspace)
        it.listType = item.listType
        it.bulletChar = item.bulletChar
        it.delimiter = item.delimiter
        it.markerOffset = item.markerOffset
        it.padding = item.padding
        return 1
      }
    }
    // indented code
    if (this.indented && this.tip.type !== "paragraph" && !this.blank) {
      this.advanceOffset(4)
      this.closeUnmatchedBlocks()
      this.addChild("code_block", this.offset)
      return 2
    }
    return 0
  }

  private parseListMarker(container: MdNode): MdNode | null {
    const rest = this.rest()
    const data = new MdNode("item")
    data.markerOffset = this.indent
    let marker: string
    const bullet = rest.match(BULLET)
    const ordered = bullet ? null : rest.match(ORDERED)
    if (bullet) {
      marker = bullet[0]
      data.listType = "bullet"
      data.bulletChar = marker
    } else if (ordered && (container.type !== "paragraph" || ordered[1] === "1")) {
      marker = ordered[0]
      data.listType = "ordered"
      data.delimiter = ordered[2] ?? "."
    } else return null
    const after = this.peekAt(this.nextNonspace + marker.length)
    if (after !== "" && after !== " ") return null
    if (container.type === "paragraph" && !/[^ ]/.test(this.line.slice(this.nextNonspace + marker.length))) return null
    this.advanceNextNonspace()
    this.advanceOffset(marker.length)
    const spacesStart = this.offset
    let spaces = 0
    while (this.peekAt(this.offset) === " " && spaces < 5) {
      this.advanceOffset(1)
      spaces++
    }
    const blankItem = this.offset >= this.line.length
    if (spaces >= 5 || spaces < 1 || blankItem) {
      data.padding = marker.length + 1
      this.offset = spacesStart
      if (this.peekAt(this.offset) === " ") this.advanceOffset(1)
    } else data.padding = marker.length + spaces
    return data
  }

  private incorporateLine(ln: string): void {
    let container: MdNode = this.doc
    this.oldtip = this.tip
    this.offset = 0
    this.blank = false
    this.line = ln
    for (;;) {
      const last = container.lastChild
      if (!last || !last.open) break
      container = last
      this.findNextNonspace()
      const r = this.continues(container)
      if (r === 1) {
        container = container.parent ?? this.doc
        break
      }
      if (r === 2) return
    }
    this.allClosed = container === this.oldtip
    this.lastMatchedContainer = container
    let matchedLeaf = container.type !== "paragraph" && acceptsLines(container.type)
    while (!matchedLeaf) {
      this.findNextNonspace()
      if (!this.indented && !/^[#`~*+_=<>0-9-]/.test(this.peekAt(this.nextNonspace))) {
        this.advanceNextNonspace()
        break
      }
      const r = this.blockStart(container)
      if (r === 0) {
        this.advanceNextNonspace()
        break
      }
      container = this.tip
      if (r === 2) {
        matchedLeaf = true
        break
      }
    }
    if (!this.allClosed && !this.blank && this.tip.type === "paragraph") {
      this.addLine()
      return
    }
    this.closeUnmatchedBlocks()
    if (this.blank && container.lastChild) container.lastChild.lastLineBlank = true
    const t = container.type
    const lastLineBlank = this.blank &&
      !(t === "block_quote" || (t === "code_block" && container.fenced) || (t === "item" && !container.firstChild && container.startLine === this.lineNumber))
    for (let c: MdNode | null = container; c; c = c.parent) c.lastLineBlank = lastLineBlank
    if (acceptsLines(t)) {
      this.addLine()
      if (t === "html_block" && container.htmlBlockType >= 1 && container.htmlBlockType <= 5) {
        const close = HTML_BLOCK_CLOSE[container.htmlBlockType]
        if (close && close.test(this.line.slice(this.offset))) this.finalize(container)
      }
    } else if (this.offset < this.line.length && !this.blank) {
      this.addChild("paragraph", this.offset)
      this.advanceNextNonspace()
      this.addLine()
    }
  }

  private finalize(block: MdNode): void {
    const above = block.parent
    block.open = false
    if (block.type === "paragraph") {
      const content = extractReferences(new InlineParserForRefs(), block.lines.map((l) => l.text).join("\n"), this.refmap, lineMapper(block.lines), this.links)
      if (!content.trim()) block.unlink()
      else {
        const dropped = block.lines.length - content.split("\n").length
        block.lines = block.lines.slice(dropped)
        if (block.lines[0]) block.lines[0] = { ...block.lines[0], text: content.split("\n")[0] ?? "" }
      }
    } else if (block.type === "html_block") {
      this.anchors.push(...htmlAnchorsOf(block.lines.map((l) => l.text).join("\n")))
    } else if (block.type === "code_block") {
      // A fenced block's first line is the rest of its opening fence, the info string; an indented block drops its trailing blank lines.
      const lines = block.lines.map((l) => l.text)
      const info = block.fenced ? (lines.shift() ?? "").trim().split(/[ \t]/)[0] ?? "" : ""
      while (!block.fenced && lines.length && !lines[lines.length - 1]?.trim()) lines.pop()
      this.code.push({ info, text: lines.join("\n"), line: block.startLine })
    }
    this.tip = above ?? this.doc
  }

  private processInlines(): void {
    const parser = new InlineParser(this.refmap, this.links, this.anchors)
    const walk = (n: MdNode): void => {
      if (n.type === "paragraph" || n.type === "heading") {
        const content = n.lines.map((l) => l.text).join("\n")
        parser.parse(n, content, lineMapper(n.lines))
        if (n.type === "heading") this.headings.push({ text: plainText(n).trim(), line: n.lines[0]?.line ?? n.startLine })
        return
      }
      if (isContainer(n.type)) { for (let c = n.firstChild; c; c = c.next) walk(c) }
    }
    walk(this.doc)
  }
}

const sameList = (list: MdNode, item: MdNode): boolean =>
  list.listType === item.listType && list.delimiter === item.delimiter && list.bulletChar === item.bulletChar

/** Map an offset in lines joined by \n to the source line it falls on. */
function lineMapper(lines: { text: string; line: number }[]): (offset: number) => number {
  const starts: number[] = []
  let at = 0
  for (const l of lines) {
    starts.push(at)
    at += l.text.length + 1
  }
  return (offset) => {
    let lo = 0, hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if ((starts[mid] ?? 0) <= offset) lo = mid
      else hi = mid - 1
    }
    return lines[lo]?.line ?? 0
  }
}

/** Parse a markdown document: its links with their lines, its headings' plain text, its HTML anchors, its code blocks. */
export function parseMarkdown(text: string): ParsedMarkdown {
  return new BlockParser().parse(text)
}
