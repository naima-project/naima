// Where Naima lives in a project, and how a run finds it.
//
//   naima-tracker/              the one folder Naima owns in a project (any name works)
//     README.md                 what Naima is, and the two commands that restore the program
//     .gitignore                ignores naima/
//     naima/                    the program: a git clone of Naima, at the commit naima.json locks
//     naima-data/               the data: the items, and naima.json
//       naima.json              the anchor: the data format, the lock, the project's facts
//
// The program finds its data beside itself, unless --data or NAIMA_DATA names
// it (docs/reference/format.md); the anchor is always a naima.json that
// carries `format`.

import { existsSync, realpathSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

export const TRACKER_DIR = "naima-tracker"
export const DATA_DIR = "naima-data"
export const PROGRAM_DIR = "naima"
export const DATA_FILE = "naima.json"
/** The data directory, from the project root, unless moved. */
export const DEFAULT_DATA = `${TRACKER_DIR}/${DATA_DIR}`
/** The program directory, from the data directory, unless `program` moves it. */
export const DEFAULT_PROGRAM = `../${PROGRAM_DIR}`

/**
 * The folder the runtime sat in before the product moved it to the top of its
 * repository: a commit holding `naima/src/cli.ts` is of that old layout, which
 * `naima update` moves past.
 */
export const RUNTIME_DIR = "naima"

/** Where a program directory's code is: the directory itself, a clone of the product. Null when it holds none. */
export function runtimeOf(program: string): string | null {
  return existsSync(join(program, "src", "cli.ts")) ? program : null
}

/** Naima's home, linked from every tracker's README. */
export const HOME = "https://github.com/naima-project/naima"
/** What Naima is, in one sentence after its name: shared by Naima's README and every tracker's. */
export const ABOUT = "is a silent software house of AI agents: it turns vibe coding into an exact science."
/**
 * The tracker folder's README.md, as `naima init` writes it: what Naima is,
 * and the two commands that restore a missing program — `parent` is the
 * tracker folder from the project root, `source` the lock's.
 */
export const trackerReadme = (parent: string, source: string): string =>
  `[Naima](${HOME}) ${ABOUT}

\`${PROGRAM_DIR}/\`, the program, is a git clone of ${source} that git ignores; \`${DATA_DIR}/${DATA_FILE}\` locks its commit. A fresh clone of this project restores it with:

    git clone ${source} ${parent}/${PROGRAM_DIR}
    deno run -A ${parent}/${PROGRAM_DIR}/naima.ts check

New to this project, as a person or an agent? Run those two commands in your clone, or ask your agent to run \`naima hello\`: that first run also points git at the project's hooks, which git keeps per clone. The trunk is guarded: a commit, merge or fast-forward of it made by hand is refused, and work lands through \`naima open\` and \`naima land\`. A project that prefers committing by hand turns the guard off with \`naima guard off\`.
`

/**
 * The exit code with which a program asks the launcher to run it again: it
 * has just aligned the program directory, so the code that should run is on
 * disk and not the code that is running.
 */
export const RELAUNCH = 75

/**
 * The data directory: `given` (the `--data` flag, or `NAIMA_DATA`) resolved
 * from `cwd`, else the program's sibling, `dirname(program)/naima-data`. The
 * program knows where its data is from where it is.
 */
export function findData(cwd: string, program: string, given?: string): string {
  return given ? resolve(cwd, given) : join(dirname(resolve(program)), DATA_DIR)
}

/**
 * The tracker folder of a data directory: its parent when that is a
 * `naima-tracker/`, or holds the program as a clone beside the data (the
 * parent of an installed Naima may have any name), else the data directory
 * itself. It bounds what Naima writes, so a data directory moved to the
 * project root never widens it to the project.
 */
export const trackerOf = (data: string): string =>
  basename(dirname(data)) === TRACKER_DIR || existsSync(join(dirname(data), PROGRAM_DIR, ".git")) ? dirname(data) : data

/** A path with its symlinks resolved, as git names it; resolved only, when it does not exist yet. */
export const real = (path: string): string => (existsSync(path) ? realpathSync(path) : resolve(path))

/**
 * `naima [--data <dir>] <command> [args]`: the one global option, which comes
 * first. The launcher and the program both read it, through this one parser.
 */
export function globalOptions(argv: string[]): { data?: string; rest: string[] } {
  const [first, second, ...rest] = argv
  if (first === "--data") {
    if (!second) throw new Error("--data needs a directory")
    return { data: second, rest }
  }
  if (first?.startsWith("--data=")) {
    const data = first.slice("--data=".length)
    if (!data) throw new Error("--data needs a directory")
    return { data, rest: argv.slice(1) }
  }
  return { rest: argv }
}
