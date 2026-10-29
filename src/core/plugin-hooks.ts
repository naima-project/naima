// The hooks plugins ask the agent tool to run (the `agent-hooks` point): a
// stance that reruns its checks after every edit, say. Naima writes them into
// the tool's settings itself, through the tool's adapter, beside its own hooks
// and the project's, so that no plugin writes the host's settings: at naima
// init and naima update (after the plugins' setup), and at naima stance adopt.
// Each is named in the file by its id, <plugin>/<name>, so a hook whose plugin
// is gone is removed at the next of these, and naima check notes it until then.

import { writeLaunchers } from "./launchers.ts"
import { join } from "node:path"
import { adapter, type AgentAdapter, type PluginHook } from "./adapters/index.ts"
import { posixRelative } from "./config.ts"
import { mayWrite } from "./files.ts"
import { PROGRAM_DIR, trackerOf } from "./layout.ts"
import { adaptersInUse } from "./session-start.ts"
import type { AgentHookContribution, Context } from "./types.ts"

/** The launcher, from the project root, as a hook names it. */
const programPath = (ctx: Context): string => posixRelative(ctx.root, join(trackerOf(ctx.trackerRoot), PROGRAM_DIR, "naima.ts"))

/** Every hook the loaded plugins contribute, with the tool it is for. */
function contributed(ctx: Context): { tool: string; hook: PluginHook; says: string }[] {
  return ctx.registry.contributions("agent-hooks").map((c) => {
    const h = c.value as AgentHookContribution
    return {
      tool: h.tool,
      says: h.says,
      hook: { id: c.id, event: h.event, ...(h.matcher !== undefined ? { matcher: h.matcher } : {}), command: [...h.command] },
    }
  })
}

/** The tools in use that keep plugins' hooks, each with the hooks wanted there. */
function targets(ctx: Context): { tool: AgentAdapter; wanted: { hook: PluginHook; says: string }[] }[] {
  const all = contributed(ctx)
  return adaptersInUse(ctx.root, ctx.config.agents).filter((a) => a.pluginHooks).map((a) => ({
    tool: a,
    wanted: all.filter((h) => h.tool === a.id),
  }))
}

/**
 * Make each tool's settings hold exactly the hooks the loaded plugins contribute for it: add the missing, bring the
 * changed up to date, remove those whose plugin is gone. Returns one plain sentence for each change, or for what this
 * run may not write.
 */
export function installPluginHooks(ctx: Context): string[] {
  const out: string[] = []
  for (const { tool, wanted } of targets(ctx)) {
    const settings = tool.pluginHooks!
    const file = settings.file
    const program = programPath(ctx)
    const pending = pendingIn(ctx, tool, wanted.map((w) => w.hook))
    if (!pending.length) continue
    if (!mayWrite(join(ctx.root, file))) {
      out.push(`not written, this run may not write it: the plugins' hooks in ${file} — naima update writes them`)
      continue
    }
    // The hooks run Naima through the committed launchers beside the program's folder: they are there first.
    if (/(^|\/)[^/]+\/naima\.ts$/.test(program)) out.push(...writeLaunchers(ctx.root, join(ctx.root, program.replace(/[^/]+\/naima\.ts$/, ""))).said)
    const r = settings.sync(ctx.root, program, wanted.map((w) => w.hook))
    if ("refused" in r) {
      out.push(`the plugins' hooks are not written to ${file}: ${r.refused} — fix the file, then run naima update`)
      continue
    }
    const says = (id: string): string => wanted.find((w) => w.hook.id === id)?.says ?? ""
    for (const id of r.added) out.push(`Installed ${id}, a ${tool.name} hook a plugin contributes, in ${file}: ${says(id)}.`)
    for (const id of r.updated) out.push(`Brought ${id}, a ${tool.name} hook a plugin contributes, up to date in ${file}: ${says(id)}.`)
    for (const id of r.removed) out.push(`Removed ${id} from ${file}: no loaded plugin contributes that hook any more.`)
  }
  return out
}

/** What differs between `tool`'s settings and the hooks wanted there: each said with what naima update does about it. */
function pendingIn(ctx: Context, tool: AgentAdapter, wanted: readonly PluginHook[]): string[] {
  const settings = tool.pluginHooks!
  const program = programPath(ctx)
  const installed = settings.installed(ctx.root)
  const out: string[] = []
  for (const h of wanted) {
    const at = installed.filter((i) => i.id === h.id)
    const line = settings.line(h, program)
    if (!at.length) out.push(`${h.id}, a ${tool.name} hook a plugin contributes, is missing from ${settings.file}: naima update installs it`)
    else if (at.length > 1 || at[0]!.event !== h.event || at[0]!.matcher !== h.matcher || at[0]!.line !== line) {
      out.push(`${h.id}, a ${tool.name} hook a plugin contributes, is out of date in ${settings.file}: naima update rewrites it`)
    }
  }
  for (const id of new Set(installed.map((i) => i.id))) {
    if (!wanted.some((h) => h.id === id)) out.push(`${settings.file} holds ${id}, a hook no loaded plugin contributes: naima update removes it`)
  }
  return out
}

/** What `naima check` notes: each plugin hook missing, out of date or left behind, and each that names a tool Naima has no adapter for or a command no plugin declares. */
export function pluginHookGaps(ctx: Context): string[] {
  const out: string[] = []
  for (const { tool, hook } of contributed(ctx)) {
    if (!adapter(tool)?.pluginHooks) out.push(`${hook.id} is a hook for ${tool}, which Naima has no adapter with hooks for: it is never installed`)
    const name = hook.command[0]!
    if (!ctx.registry.contributions("commands").some((c) => c.name === name || c.id === name)) {
      out.push(`${hook.id} runs naima ${hook.command.join(" ")}, and no loaded plugin declares the command ${name}`)
    }
  }
  for (const { tool, wanted } of targets(ctx)) out.push(...pendingIn(ctx, tool, wanted.map((w) => w.hook)))
  return out
}
