// The landing check that keeps a branch's files formatted: a project that names a formatter's check in the
// coordination option `formatCheck` has `naima land` run it on the branch tip's files, so that a file the project's
// formatter rejects never reaches the trunk or a development line, and a suite does not stop at its format stage.

import { spawnSync } from "node:child_process"
import { stripVTControlCharacters } from "node:util"
import type { Context } from "../../core/api.ts"
import type { LandingReport } from "./land.ts"

/** How many lines of the formatter's report a refusal shows. */
const SHOWN = 8

/**
 * The coordination option `formatCheck`: the words of a command that exits with a failure when a file is not formatted,
 * such as `deno fmt --check`. Unset or empty means the project has no such check. It is run without a shell, so the
 * words are split on spaces and no quoting applies.
 */
export function readFormatCheck(options: Record<string, unknown>): string[] {
  const v = options["formatCheck"]
  if (v === undefined || v === "") return []
  if (typeof v !== "string") throw new Error(`coordination: option formatCheck must be a command, such as "deno fmt --check"; got ${JSON.stringify(v)}`)
  return v.split(/\s+/).filter(Boolean)
}

/** The landing check for `command` (the words `readFormatCheck` returns); without a command it finds nothing. */
export function formattedLanding(command: string[]): LandingReport {
  return {
    name: "formatted",
    says:
      "refuses a branch whose files the project's formatter rejects: the command the coordination option formatCheck names (such as `deno fmt --check`) is run on the branch tip's files, and the landing is refused when it fails",
    refuses(ctx: Context): string[] {
      if (!command.length) return []
      const [program, ...args] = command as [string, ...string[]]
      const r = spawnSync(program, args, { cwd: ctx.root, encoding: "utf8", windowsHide: true })
      if (r.error) throw new Error(`${command.join(" ")} did not run: ${r.error.message}`)
      if (r.status === 0) return []
      const said = stripVTControlCharacters(`${r.stdout}\n${r.stderr}`).split("\n").map((l) => l.trimEnd()).filter(Boolean)
      return [
        `${command.join(" ")} finds files that are not formatted (exit ${r.status}); run the formatter and commit the result`,
        ...(said.length > SHOWN ? [`… ${said.length - SHOWN} earlier lines left out`] : []),
        ...said.slice(-SHOWN),
      ]
    },
  }
}
