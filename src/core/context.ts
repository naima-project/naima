// The object every command, check and view receives.

import { posixRelative } from "./config.ts"
import { deepFreeze } from "./collections.ts"
import { writes } from "./item.ts"
import { loadRepo } from "./repo.ts"
import { trackerGitOf } from "./repos.ts"
import type { Config, Context, Registry, Repo } from "./types.ts"

export interface IO {
  out(line?: string): void
  err(line: string): void
  now(): Date
}

// A reader that closes early (`naima list | head -1`) breaks the pipe: Deno, Node and Bun each
// surface that differently — a thrown error here, an async "error" event there, EPIPE on a real
// pipe or ENOTCONN when the runtime's stdout is backed by a socket (Bun, under load) — so all of
// them are caught and treated the same way a closed pipe should end a CLI: quietly, exit code 0.
const BROKEN_PIPE_CODES = new Set(["EPIPE", "ENOTCONN", "ECONNRESET"])
function isEpipe(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && BROKEN_PIPE_CODES.has(String((err as { code?: unknown }).code))
}
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err) => {
    if (isEpipe(err)) process.exit(0)
    throw err
  })
}
function writeLine(stream: NodeJS.WriteStream, line: string): void {
  try {
    stream.write(line + "\n")
  } catch (err) {
    if (isEpipe(err)) process.exit(0)
    throw err
  }
}

export const consoleIO: IO = {
  out: (line = "") => writeLine(process.stdout, line),
  err: (line) => writeLine(process.stderr, line),
  now: () => new Date(),
}

/** Where a project is: its root, its data directory, and the program that runs it. All absolute. */
export interface Place {
  root: string
  data: string
  program: string
}

export function createContext(place: Place, config: Config, registry: Registry, io: IO = consoleIO): Context {
  const trackerRoot = place.data
  const trackerGit = trackerGitOf(place.root, trackerRoot)
  let repo: Repo | null = null
  let readAt = -1
  return {
    root: place.root,
    trackerRoot,
    trackerDir: posixRelative(place.root, trackerRoot),
    trackerGit,
    trackerPrefix: trackerGit === place.root ? posixRelative(place.root, trackerRoot) : "",
    sibling: trackerGit !== place.root,
    program: place.program,
    config: deepFreeze(config),
    registry,
    get repo() {
      // Every write through the core's helpers moves `writes()`: the next read sees it.
      if (repo === null || readAt !== writes()) {
        readAt = writes()
        repo = loadRepo(trackerRoot, registry)
      }
      return repo
    },
    reload() {
      repo = null
    },
    out: io.out,
    err: io.err,
    now: io.now,
  }
}
