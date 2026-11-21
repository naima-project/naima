// The Models tab's workbench on a study (develop/models-tab.md §15): the files a person edits in the tab, written back
// through the bridge, and the command line of each job the tab starts under `naima run`: a check of the study's
// properties (naima model-check, the verifier-mcrl2 plugin's command), the generation of its code (naima-codegen, then
// the build the study declares) and a run of its program. When a job may start is the tab's machine's to decide
// (develop/models/ui/study/); this file only says what each job runs.

import { Buffer } from "node:buffer"
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { CODEGEN_MISSING } from "../../core/api.ts"
import type { Study } from "./studies.ts"

/** The folders of a study never listed for editing: what tools write, and what a person never edits by hand. */
const SKIPPED = new Set(["generated", "build", "target", "node_modules", "paths", "dist"])
/** The kinds of file the editor opens. */
const EDITED = new Set([".mcrl2", ".mcf", ".toml", ".rs", ".ts", ".svelte", ".sh", ".cmd", ".md", ".json"])
/** Files of those kinds a tool writes. */
const LOCKS = new Set(["Cargo.lock", "deno.lock", "package-lock.json"])
/** At most this many files are listed, and none larger than this is opened. */
const MAX_FILES = 300
export const MAX_BYTES = 2_000_000

const slash = (p: string): string => p.split(sep).join("/")

/** The order the editor lists files in: the model first, then the study's own file, the other mCRL2 files, then the rest. */
function rank(rel: string, study: Study, folder: string, root: string): number {
  const abs = resolve(folder, rel)
  if (study.model && abs === resolve(root, study.model)) return 0
  if (abs === resolve(root, study.file)) return 1
  const ext = extname(rel)
  return { ".mcrl2": 2, ".toml": 3, ".mcf": 4, ".rs": 5 }[ext] ?? 6
}

/** The files of a study a person may edit in the tab, relative to its declaring file's folder, in the editor's order. */
export function studyFiles(root: string, study: Study): string[] {
  const folder = join(root, dirname(study.file))
  // A plain model shares its folder with others: its files are itself and its properties.
  if (study.kind === "plain") {
    return [basename(study.file), ...study.properties].filter((f) => {
      try {
        return statSync(join(folder, f)).size <= MAX_BYTES
      } catch {
        return false
      }
    })
  }
  const out: string[] = []
  const walk = (dir: string, depth: number): void => {
    let names: string[]
    try {
      names = readdirSync(dir).sort()
    } catch {
      return
    }
    for (const name of names) {
      if (out.length >= MAX_FILES || name.startsWith(".")) continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (!SKIPPED.has(name) && depth < 4) walk(full, depth + 1)
      } else if (EDITED.has(extname(name)) && !LOCKS.has(name) && st.size <= MAX_BYTES) {
        out.push(slash(relative(folder, full)))
      }
    }
  }
  walk(folder, 0)
  return out.sort((a, b) => rank(a, study, folder, root) - rank(b, study, folder, root) || a.localeCompare(b))
}

/** The absolute path of a study's file the editor may open or write, or why not. */
export function studyFilePath(root: string, study: Study, rel: string): string | { refused: string } {
  if (!rel || isAbsolute(rel) || rel.includes("\u0000")) return { refused: `${rel} is not a file of the study` }
  if (!studyFiles(root, study).includes(rel)) {
    return { refused: `${rel} is not a file of the study the tab edits: generated files, builds and saved paths are written by tools` }
  }
  return resolve(root, dirname(study.file), rel)
}

export function readStudyFile(root: string, study: Study, rel: string): string {
  const path = studyFilePath(root, study, rel)
  if (typeof path !== "string") throw new Error(path.refused)
  return readFileSync(path, "utf8")
}

export function writeStudyFile(root: string, study: Study, rel: string, text: string): void {
  const path = studyFilePath(root, study, rel)
  if (typeof path !== "string") throw new Error(path.refused)
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new Error(`${rel} would be larger than ${MAX_BYTES} bytes`)
  writeFileSync(path, text)
}

/** A word of a command line, quoted for the shell that runs it: POSIX sh, or Windows' cmd. */
export function quoted(word: string, windows: boolean): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(word)) return word
  return windows ? `"${word.replace(/"/g, '""')}"` : `'${word.replace(/'/g, `'\\''`)}'`
}

/** The jobs of the workbench. */
export type Job = "check" | "generate" | "run"

/** What a job needs besides the study: where the project is, how Naima and naima-codegen are started, the platform. */
export interface JobContext {
  root: string
  /** The command line that starts this Naima on the project's data, before its command's words. */
  naima: readonly string[]
  /** How naima-codegen is started, or null when it is not installed. */
  codegen: readonly string[] | null
  /** What a study's build needs to start naima-codegen itself (`codegenEnv`), set before its command; absent, none. */
  codegenEnv?: Readonly<Record<string, string>>
  windows: boolean
}

/** naima-codegen as a command line, from where it was found (core/tools.ts, findCodegen): on Windows a script without an
 * extension is handed to Python, the one Naima installed (`naima tools install python`) when `python` names it, else the
 * one on PATH; null when it was found nowhere. */
export function codegenCommand(found: string | null, windows: boolean, python: string | null = null): string[] | null {
  if (!found) return null
  return windows && !/\.(exe|com|cmd|bat)$/i.test(found) ? [python ?? "python", found] : [found]
}

/**
 * What a study's build script needs to start naima-codegen itself, as environment variables: on Windows `NAIMA_CODEGEN`,
 * which a batch file calls, so a program or the `naima-codegen.cmd` that sits beside the script (it starts the script
 * with the Python named by `NAIMA_PYTHON`), and that Python when Naima installed one. Elsewhere the script runs itself and
 * the launcher has already named it.
 */
export function codegenEnv(
  found: string | null,
  windows: boolean,
  python: string | null,
  exists: (file: string) => boolean = existsSync,
): Record<string, string> {
  if (!found || !windows) return {}
  const runnable = /\.(exe|com|cmd|bat)$/i.test(found) ? found : exists(`${found}.cmd`) ? `${found}.cmd` : null
  return { ...(runnable ? { NAIMA_CODEGEN: runnable } : {}), ...(python ? { NAIMA_PYTHON: python } : {}) }
}

/**
 * The command line of a job, run through the platform's shell by `naima run`, or why the study cannot run it. `property`
 * narrows a check to one property file; absent, every property of the study is checked.
 */
export function jobLine(job: Job, study: Study, ctx: JobContext, property?: string): string | { refused: string } {
  const folder = resolve(ctx.root, dirname(study.file))
  const q = (w: string) => quoted(w, ctx.windows)
  const line = (words: readonly string[]) => words.map(q).join(" ")
  const inFolder = (command: string) => (ctx.windows ? `cd /d ${q(folder)} && ${command}` : `cd ${q(folder)} && ${command}`)
  const withEnv = (command: string) => ctx.windows ? Object.entries(ctx.codegenEnv ?? {}).map(([k, v]) => `set "${k}=${v}" && `).join("") + command : command
  const generate = ctx.codegen ? line([...ctx.codegen, "generate", "--project", folder]) : null
  if (job === "check") {
    if (!study.system) return { refused: "the study declares no system to check its properties on (% system in its %@ui block)" }
    const props = property === undefined ? study.properties : study.properties.filter((p) => p === property)
    if (!props.length) {
      return {
        refused: property === undefined ? "the study has no property files (% properties in its %@ui block)" : `${property} is not a property of the study`,
      }
    }
    const rel = (p: string) => slash(relative(ctx.root, resolve(folder, p)))
    const check = line([
      ...ctx.naima,
      "model-check",
      rel(study.system),
      ...props.map(rel),
      ...(study.paths ? ["--paths", rel(study.paths)] : []),
      "--origin",
      `checked in the Models tab`,
    ])
    // The system a naima-codegen study is checked on is generated from its model: generated again first, so that the
    // check sees the model as saved. Naima runs from the project's root, where the paths it is given start.
    const atRoot = ctx.windows ? `cd /d ${q(ctx.root)} && ` : `cd ${q(ctx.root)} && `
    // Without naima-codegen the system is checked as it was last generated, and the output says so first.
    const stale = `echo ${
      q(`naima-codegen is not installed, so the properties are checked on ${study.system} as it was last generated, not on the model as saved. ${CODEGEN_MISSING}`)
    }`
    return atRoot + (!study.codegen ? check : generate ? `${generate} && ${check}` : `${stale} && ${check}`)
  }
  if (job === "generate") {
    if (!study.codegen) return { refused: "the study's folder holds no codegen.toml: there is nothing for naima-codegen to generate" }
    if (!generate) return { refused: CODEGEN_MISSING }
    return study.build ? `${generate} && ${withEnv(inFolder(study.build))}` : generate
  }
  if (!study.run) return { refused: "the study declares no program to run (% run in its %@ui block)" }
  return inFolder(study.run)
}

/** The whole line as the supervisor hands it to the shell: cmd strips one pair of outer quotes (/s), so it gets one. */
export const shellLine = (line: string, windows: boolean): string => (windows ? `"${line}"` : line)
