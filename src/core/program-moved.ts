// Telling what runs for long that the program moved: `naima update` (and the alignment that follows the lock) writes
// one small file in Naima's state folder for the clone, program-moved.json, and a long-running process of the project,
// the UI server above all, reads it to restart on the new program (plugins/ui/restart.ts). The file holds when the
// program moved and the commit it moved to; a process started before then runs the old code.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { stateDir } from "./tick.ts"

/** What the file says: when the program moved (ms since the epoch) and the commit it moved to. */
export interface ProgramMoved {
  at: number
  commit: string
}

const fileOf = (root: string): string | null => {
  const state = stateDir(root)
  return state ? join(state, "program-moved.json") : null
}

/** Say that the program of the project at `root` moved to `commit`. Never throws: a write that fails only leaves a running UI on the old code. */
export function announceProgramMoved(root: string, commit: string, at = Date.now()): void {
  try {
    const file = fileOf(root)
    if (!file) return
    mkdirSync(join(file, ".."), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify({ at, commit } satisfies ProgramMoved) + "\n")
    renameSync(temp, file)
  } catch {
    // nothing to tell it with
  }
}

/** When the program of the project at `root` last moved, or null when it was never said. */
export function programMoved(root: string): ProgramMoved | null {
  try {
    const file = fileOf(root)
    const v = file ? JSON.parse(readFileSync(file, "utf8")) as Partial<ProgramMoved> : null
    return v && typeof v.at === "number" && typeof v.commit === "string" ? { at: v.at, commit: v.commit } : null
  } catch {
    return null
  }
}
