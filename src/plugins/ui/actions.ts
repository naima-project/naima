// The UI's actions and how a naima command is run in this process: the actions the UI may start as a run of `naima run`,
// and the runner, shared by the bridge (bridge.ts) and the tracker's MCP server (mcp-tracker.ts). Nothing of the screen.

import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Command, Context } from "../../core/api.ts"

/**
 * The actions the UI may run: its name, the command's words, and what it does. None of them rewrites history. An
 * action that takes long says its time budget and that its command writes its own progress (`naima run`'s progress
 * file); the others end within 5 minutes and print their result when they end.
 */
export const ACTIONS: readonly { name: string; words: string[]; says: string; budget?: string; progress?: boolean; noArgs?: boolean }[] = [
  { name: "decide", words: ["decide"], says: "record a decision on an item" },
  { name: "note", words: ["note"], says: "add a note to an item" },
  { name: "gate-step", words: ["gate", "step"], says: "close a step of a gate with the item that records it (not add or remove one)" },
  { name: "claim", words: ["claim"], says: "claim items for this branch, or post its step" },
  {
    name: "release",
    words: ["release"],
    says: "release items from this branch's claim, or from another branch's with --of <branch>: args are the items, then --of and the branch (naima release)",
  },
  { name: "plan-propose", words: ["plan"], says: "propose or revise the note on a goal's plan: args are the goal and the note (naima plan <goal> --propose)" },
  {
    name: "plan-approve",
    words: ["plan"],
    says: "the owner approves a goal's plan as it is now: args are the goal (naima plan <goal> --approve); the owner's alone, never an agent's",
  },
  { name: "name-stop", words: ["name-stop"], says: "give a commit of the map a name of the owner's own, or clear it (naima name-stop)" },
  {
    name: "meeting-take",
    words: ["meeting", "take"],
    says: "take a meeting now: record that it started and wake the agent waiting with naima meeting wait (naima meeting take <meeting>)",
  },
  { name: "meeting-new", words: ["meeting", "new"], says: 'declare a meeting, with a date or none (naima meeting new <name> "<title>" [--on YYYY-MM-DD])' },
  { name: "meeting-add", words: ["meeting", "add"], says: "put items that need the owner on a meeting's agenda (naima meeting add <meeting> <item>...)" },
  { name: "meeting-move", words: ["meeting", "move"], says: "move items to another meeting, noted on each (naima meeting move <meeting> <item>...)" },
  { name: "meeting-off", words: ["meeting", "off"], says: "take items off every meeting, back to needing the owner (naima meeting off <item>...)" },
  { name: "meeting-date", words: ["meeting", "date"], says: "set a meeting's date, or clear it with none (naima meeting date <meeting> <YYYY-MM-DD|none>)" },
  {
    name: "record-metrics",
    words: ["metrics", "run", "--record"],
    says: "record the metrics of the commit checked out, each run of a test suite with its log (naima metrics run --record)",
    budget: "2h",
    progress: true,
    noArgs: true,
  },
]

/** An action by its name. */
export const actionOf = (name: string) => ACTIONS.find((a) => a.name === name)

/** The command line of an action, or why it is refused. */
export function actionArgv(name: string, args: unknown): string[] | string {
  const action = ACTIONS.find((a) => a.name === name)
  if (!action) return `no action ${name}: the actions are ${ACTIONS.map((a) => a.name).join(", ")}`
  if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) return "args is a list of strings, the arguments after the command"
  // gate step add and remove change what a gate is; only closing a step is the UI's.
  if (action.name === "gate-step" && (args[0] === "add" || args[0] === "remove")) return `gate step ${args[0]} is not an action of the UI`
  if (action.noArgs && args.length) return `${action.name} takes no arguments`
  // The plan's actions take the goal (and the note), never a flag of their own: the flag is the action's.
  const plain = (args as string[]).every((a) => !a.startsWith("-"))
  if (action.name === "plan-propose") {
    return args.length === 2 && plain ? ["plan", args[0] as string, "--propose", args[1] as string] : "plan-propose takes the goal and the note"
  }
  if (action.name === "plan-approve") return args.length === 1 && plain ? ["plan", args[0] as string, "--approve"] : "plan-approve takes the goal"
  return [...action.words, ...(args as string[])]
}

/** The program that is running: the directory above src/. */
const PROGRAM = fileURLToPath(new URL("../../../", import.meta.url))

/** How a command of this program is started as a person types it: on Deno through the launcher, which sets its permissions. */
export function naimaEntry(): string[] {
  const deno = (globalThis as { Deno?: { execPath(): string } }).Deno
  return deno ? [deno.execPath(), "run", "-A", join(PROGRAM, "naima.ts")] : [process.execPath, join(PROGRAM, "src", "cli.ts")]
}

/** Runs a naima command in this process, through the command the registry holds, and keeps what it prints. */
export async function runCommand(ctx: Context, words: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  const cmd = ctx.registry.find<Command>("commands", words[0]!)?.value
  if (!cmd) return { code: 2, out: "", err: `no command ${words[0]}` }
  const out: string[] = []
  const err: string[] = []
  const quiet = Object.create(ctx, { out: { value: (l = "") => void out.push(l) }, err: { value: (l = "") => void err.push(l) } }) as Context
  try {
    const code = await cmd.run(words.slice(1), quiet)
    return { code: typeof code === "number" ? code : 0, out: out.join("\n"), err: err.join("\n") }
  } catch (e) {
    return { code: 1, out: out.join("\n"), err: [...err, e instanceof Error ? e.message : String(e)].join("\n") }
  }
}
