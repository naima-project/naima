// A trivial adapter that shows the shape of a real one. The "model" is any
// text file and the property is one of:
//
//   some <regex>    holds when at least one line matches
//   never <regex>   holds when no line matches; the first match is the counterexample
//
// A line `#include <path>` stands for the lines of that file, the path taken
// from the including file's directory: the adapter's inputs are the model and
// every file it includes, so a change to an included file makes a verdict
// stale, as a real tool's includes would.
//
// A real adapter (mCRL2) runs the tool, maps its exit status and
// output to a verdict, and returns the trace it printed.

import { existsSync, readFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { message } from "../../../core/api.ts"
import type { Verifier, VerifyRequest, VerifyResult } from "../contract.ts"

const INCLUDE = /^#include\s+(\S+)\s*$/

/** One line of the model as read, includes expanded: where it is (`n`, or `file:n` for an included file) and its text. */
interface Line {
  at: string
  text: string
}

/** The model's lines with every include expanded, the files read, in order, and why it stopped when an include is missing. */
function expand(model: string): { lines: Line[]; files: string[]; problem?: string } {
  const files: string[] = []
  const lines: Line[] = []
  const read = (file: string): string | undefined => {
    if (files.includes(file)) return // read once: an include cycle stops here
    files.push(file)
    // One trailing newline ends the last line; it does not start another. CRLF files match as LF ones.
    const own = readFileSync(file, "utf8").replace(/\r?\n$/, "").split(/\r?\n/)
    for (const [n, text] of own.entries()) {
      const inc = INCLUDE.exec(text)?.[1]
      if (inc === undefined) {
        lines.push({ at: file === model ? `${n + 1}` : `${relative(dirname(model), file)}:${n + 1}`, text })
        continue
      }
      const target = resolve(dirname(file), inc)
      if (!existsSync(target)) return `included file ${inc} does not exist`
      const why = read(target)
      if (why) return why
    }
  }
  const problem = read(model)
  return problem ? { lines, files, problem } : { lines, files }
}

/** The whole check, synchronous: a real adapter awaits its tool here. */
function check({ model, property }: VerifyRequest): VerifyResult {
  const m = property.match(/^(some|never)\s+(.+)$/)
  if (!m?.[1] || !m[2]) return { verdict: "error", output: `property must be "some <regex>" or "never <regex>", got: ${property}` }
  let re: RegExp
  try {
    re = new RegExp(m[2])
  } catch (e) {
    return { verdict: "error", output: `bad regex: ${message(e)}` }
  }
  const { lines, problem } = expand(model)
  if (problem) return { verdict: "error", output: problem }
  const hit = lines.find((l) => re.test(l.text))
  if (m[1] === "some") {
    return !hit
      ? { verdict: "violated", output: "no line matches", counterexample: `no line of the model matches /${m[2]}/` }
      : { verdict: "holds", output: `line ${hit.at} matches` }
  }
  return !hit
    ? { verdict: "holds", output: `none of ${lines.length} lines matches` }
    : { verdict: "violated", output: `line ${hit.at} matches`, counterexample: `${hit.at}: ${hit.text}` }
}

export const exampleRegex: Verifier = {
  id: "example-regex",
  says: 'line-regex properties over a text file: "some <re>" or "never <re>"',
  verify: (request) => Promise.resolve(check(request)),
  inputs: ({ model }) => expand(model).files,
  version: () => "example-regex 1",
}
