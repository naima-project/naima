// The new UI's actions: POST /action/<name> runs one naima command through the
// CLI, as a person typing it would, so every rule and check of that command
// applies. Only the commands below may run, none of them rewrites history, and
// the confirmations are the UI's. The server checks each request first: the
// run's token (the cookie), this run's CSRF value (a header the page reads
// from /session), the Origin of this server, and Sec-Fetch-Site same-origin
// when the client sends it.

import { spawn } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { callerEnv } from "../../core/api.ts"

/** The actions the UI may run: its name in the path, the command's words, and what it does. */
export const ACTIONS: readonly { name: string; words: string[]; says: string }[] = [
  { name: "decide", words: ["decide"], says: "record a decision on an item" },
  { name: "note", words: ["note"], says: "add a note to an item" },
  { name: "gate-step", words: ["gate", "step"], says: "close a step of a gate with the item that records it (not add or remove one)" },
  { name: "claim", words: ["claim"], says: "claim items for this branch, or post its step" },
  { name: "release", words: ["release"], says: "release this branch's claim" },
]

/** What a command run as an action answered. */
export interface ActionResult {
  command: string[]
  code: number
  out: string
  err: string
}

/** Runs a naima command (its words and arguments) in the project's folder. */
export type ActionRunner = (argv: string[], cwd: string) => Promise<{ code: number; out: string; err: string }>

/** The command line of an action, or why it is refused. */
export function actionArgv(name: string, body: unknown): string[] | string {
  const action = ACTIONS.find((a) => a.name === name)
  if (!action) return `no action ${name}: the actions are ${ACTIONS.map((a) => a.name).join(", ")}`
  const args = (body as { args?: unknown } | null)?.args ?? []
  if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) return 'the body is {"args": [strings]}, the arguments after the command'
  // gate step add and remove change what a gate is; only closing a step is the UI's.
  if (action.name === "gate-step" && (args[0] === "add" || args[0] === "remove")) return `gate step ${args[0]} is not an action of the UI`
  return [...action.words, ...(args as string[])]
}

const isDeno = typeof (globalThis as { Deno?: unknown }).Deno !== "undefined"

/** The program that is running: the directory above src/. */
const PROGRAM = fileURLToPath(new URL("../../../", import.meta.url))

/**
 * The CLI, as a person runs it: on Deno the launcher naima.ts, which sets the permissions of the command; on Node
 * and Bun the program's entry. Its output is kept, at most 1 MB of each stream; it is stopped after five minutes.
 */
export const cliRunner = (
  entry: string[] = isDeno ? ["run", "-A", join(PROGRAM, "naima.ts")] : [join(PROGRAM, "src", "cli.ts")],
  env: Record<string, string> = {},
): ActionRunner =>
(argv, cwd) =>
  new Promise((done) => {
    const child = spawn(process.execPath, [...entry, ...argv], {
      cwd,
      env: { ...callerEnv(process.env) as Record<string, string>, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""
    let err = ""
    const keep = (s: string, more: string): string => (s.length > 1_000_000 ? s : s + more)
    child.stdout.on("data", (b: Uint8Array) => (out = keep(out, String(b))))
    child.stderr.on("data", (b: Uint8Array) => (err = keep(err, String(b))))
    const timer = setTimeout(() => child.kill(), 5 * 60_000)
    child.once("error", (e) => {
      clearTimeout(timer)
      done({ code: 127, out, err: err + String(e) })
    })
    child.once("close", (code) => {
      clearTimeout(timer)
      done({ code: code ?? 1, out, err })
    })
  })
