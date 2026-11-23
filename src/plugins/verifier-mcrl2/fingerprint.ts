// What a model's text means to mCRL2, for the fingerprint that decides whether a property's last run is current: the
// text with comments removed and whitespace normalised. A comment runs from `%` to the end of the line, outside string
// literals; Naima's own `%@ui`, `%@say`, `%@state` and `%@situation` annotation lines are comments to mCRL2, so
// adding or editing any of them does not change what the model does.

/** `text` as mCRL2 reads it: comments dropped, every run of whitespace outside a string literal as one space, the ends trimmed. */
export function meaningOf(text: string): string {
  let out = ""
  let pendingSpace = false
  for (const line of text.split(/\r\n|\r|\n/)) {
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!
      if (quoted) {
        out += c
        if (c === "\\" && i + 1 < line.length) out += line[++i]!
        else if (c === '"') quoted = false
      } else if (c === "%") {
        break
      } else if (c === " " || c === "\t") {
        pendingSpace = true
      } else {
        if (pendingSpace && out !== "") out += " "
        pendingSpace = false
        out += c
        if (c === '"') quoted = true
      }
    }
    pendingSpace = true // the line break
  }
  return out
}

/** The text a file's fingerprint is taken over: an mCRL2 model or formula file as `meaningOf` reads it; any other file as it is. */
export const fingerprintText = (path: string, text: string): string => (/\.(mcrl2|mcf)$/i.test(path) ? meaningOf(text) : text)
