// Tools: a plugin declares the tools it needs, each pinned to one version with
// a source per platform; `naima tools` reports what this machine has, `naima
// tools install` installs one — with consent, its download checked, unpacked
// into Naima's own discardable directory and verified by running it — and
// `naima tools remove` removes one. Nothing touches PATH or the system; an
// installed tool's programs reach the plugin that declared it through
// `installedProgram`. Another machine is asked through its own Naima.
// Specification: specs/tools-plugin-declares-tools-needs-naima-tools in
// Naima's own tracker; for people, docs/guide/tools.md.

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"
import {
  askHost,
  bool,
  type Command,
  type Context,
  CONTRACT,
  EXIT,
  type Host,
  installDirOf,
  NaimaError,
  noHost,
  parse,
  platformKey,
  type Plugin,
  programFile,
  progressFor,
  projectHosts,
  RECEIPT,
  str,
  toolsDir,
  usageError,
} from "../../core/api.ts"
import { isUnavailable, type Source, type ToolDeclaration, toolsPoint } from "./contract.ts"
import { type Consent, type Exec, installTool, realExec, type Receipt } from "./install.ts"

export type { Source, ToolDeclaration, Unavailable } from "./contract.ts"
export { declarationRefusal, toolsPoint } from "./contract.ts"

/** What the command reads of the world: the real one, or a test's stand-ins. */
export interface ToolsWorld {
  exec: Exec
  /** Ask a question on the terminal; the answer, or null when there is no terminal. */
  ask(question: string): Promise<string | null>
  env: Record<string, string | undefined>
  os: string
  arch: string
}

/** A line read from the terminal, or null without one. */
async function askTerminal(question: string): Promise<string | null> {
  if (!process.stdin.isTTY) return null
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await new Promise<string>((done) => rl.question(question, done))
  } finally {
    rl.close()
  }
}

export const realWorld = (): ToolsWorld => ({ exec: realExec, ask: askTerminal, env: process.env, os: process.platform, arch: process.arch })

const refuse = (msg: string): NaimaError => new NaimaError(msg)

/** A tool's state on this machine (§3). */
export type State = "installed" | "missing" | "unavailable" | "undeclared"

export interface ToolReport {
  name: string
  version: string
  plugin: string
  title: string
  licence: string
  state: State
  /** The declaration's answer for this platform, when unavailable. */
  answer?: string
  /** Other versions installed here. */
  other?: string[]
  /** The command that installs it, when it can be. */
  install?: string
  path?: string
}

/** One tool of an install plan (§4, step 1). */
export interface PlanStep {
  tool: string
  version: string
  licence: string
  homepage: string
  installed: boolean
  url?: string
  size?: number
  unpacked?: number
  sha256?: string
  format?: string
  unavailable?: string
}

const declared = (ctx: Context): { decl: ToolDeclaration; plugin: string }[] =>
  ctx.registry.contributions("tools").map((c) => ({ decl: c.value as ToolDeclaration, plugin: c.plugin }))

function declOf(ctx: Context, name: string): ToolDeclaration {
  const found = declared(ctx).find((d) => d.decl.name === name)
  if (!found) {
    const names = declared(ctx).map((d) => d.decl.name)
    throw refuse(`no plugin declares a tool "${name}"${names.length ? ` — declared: ${names.join(", ")}` : " — switch on the plugin that needs it"}`)
  }
  return found.decl
}

/** Is `tool` installed in `dir` at its pinned version, on `platform`: its receipt there, and every program it declares? */
function installedAt(dir: string, tool: ToolDeclaration, platform: string, os: string): string | null {
  const source = tool.platforms[platform as keyof ToolDeclaration["platforms"]]
  if (!source || isUnavailable(source)) return null
  const root = installDirOf(dir, tool)
  if (!existsSync(join(root, RECEIPT))) return null
  return tool.programs.every((p) => existsSync(join(root, source.bin, programFile(p, os)))) ? root : null
}

const sizeOf = (bytes: number): string =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : bytes >= 1e6
    ? `${Math.round(bytes / 1e6)} MB`
    : bytes >= 1e3
    ? `${Math.round(bytes / 1e3)} kB`
    : `${bytes} B`

/** The machine the command looks at: its platform and tools directory. */
function machine(world: ToolsWorld): { platform: string; dir: string } {
  const dir = toolsDir(world.env, world.os)
  if (!dir) throw refuse("no tools directory: set NAIMA_TOOLS to an absolute path, or HOME (LOCALAPPDATA on Windows)")
  return { platform: platformKey(world.os, world.arch), dir }
}

export function report(ctx: Context, world: ToolsWorld): { platform: string; dir: string; tools: ToolReport[] } {
  const { platform, dir } = machine(world)
  const tools = declared(ctx).map(({ decl, plugin }): ToolReport => {
    const base = { name: decl.name, version: decl.version, plugin, title: decl.title, licence: decl.licence }
    const source = decl.platforms[platform as keyof ToolDeclaration["platforms"]]
    const versions = existsSync(join(dir, decl.name))
      ? readdirSync(join(dir, decl.name)).filter((v) => v !== decl.version && existsSync(join(dir, decl.name, v, RECEIPT)))
      : []
    const other = versions.length ? { other: versions } : {}
    if (!source) return { ...base, state: "undeclared", ...other }
    if (isUnavailable(source)) return { ...base, state: "unavailable", answer: source.unavailable, ...other }
    const at = installedAt(dir, decl, platform, world.os)
    if (at) return { ...base, state: "installed", path: at, ...other }
    return { ...base, state: "missing", install: `naima tools install ${decl.name}`, ...other }
  })
  return { platform, dir, tools }
}

/** The tool and every tool it needs, those needed first, each once (§4, step 1). */
export function planOf(ctx: Context, world: ToolsWorld, name: string): PlanStep[] {
  const { platform, dir } = machine(world)
  const order: ToolDeclaration[] = []
  const visit = (n: string, path: string[]): void => {
    if (path.includes(n)) throw refuse(`the tools ${[...path, n].join(" → ")} need each other in a cycle`)
    const d = declOf(ctx, n)
    for (const need of d.needs ?? []) visit(need, [...path, n])
    if (!order.includes(d)) order.push(d)
  }
  visit(name, [])
  return order.map((d): PlanStep => {
    const base = { tool: d.name, version: d.version, licence: d.licence, homepage: d.homepage }
    const source = d.platforms[platform as keyof ToolDeclaration["platforms"]]
    if (!source) return { ...base, installed: false, unavailable: `${d.name} ${d.version} declares no source for ${platform}` }
    if (isUnavailable(source)) return { ...base, installed: false, unavailable: source.unavailable }
    return {
      ...base,
      installed: installedAt(dir, d, platform, world.os) !== null,
      url: source.url,
      size: source.size,
      ...(source.unpacked ? { unpacked: source.unpacked } : {}),
      ...(source.sha256 ? { sha256: source.sha256 } : {}),
      format: source.format,
    }
  })
}

/** The plan, as printed before the consent. */
export function planLines(plan: PlanStep[], where = "this machine"): string[] {
  const out = [`To install on ${where}:`]
  for (const s of plan) {
    if (s.installed) {
      out.push(`  ${s.tool} ${s.version}: already installed`)
      continue
    }
    if (s.unavailable) {
      out.push(`  ${s.tool} ${s.version}: unavailable here — ${s.unavailable}`)
      continue
    }
    out.push(
      `  ${s.tool} ${s.version}`,
      `    source:  ${s.url}`,
      `    size:    ${sizeOf(s.size!)} download${s.unpacked ? `, ${sizeOf(s.unpacked)} on disk` : ""}${s.sha256 ? `, sha256 ${s.sha256}` : ""}`,
      `    licence: ${s.licence} (${s.homepage})`,
    )
  }
  return out
}

/** The consent for a plan: a yes on the terminal, or --consent with --by; null when refused. */
async function consentFor(world: ToolsWorld, words: string | undefined, by: string | undefined, plan: PlanStep[], usage: string): Promise<Consent> {
  const at = new Date().toISOString()
  if (words !== undefined) {
    if (!words.trim() || !by?.trim()) throw refuse("--consent needs the yes, restated, and --by who gave it — nothing installed")
    return { how: "given with --consent", by: by.trim(), words: words.trim(), at }
  }
  const answer = await world.ask(`Install ${plan.filter((s) => !s.installed).map((s) => `${s.tool} ${s.version}`).join(" and ")}? [y/N] `)
  if (answer === null) {
    throw refuse(
      `no terminal to ask on: an install needs consent — show the plan above to the person whose machine it is, then ${usage} --consent "<their yes, restated>" --by <who> — nothing installed`,
    )
  }
  if (!/^\s*y(es)?\s*$/i.test(answer)) throw refuse("not installed: the answer was not yes")
  return { how: "asked on the terminal", by: world.env["USER"] ?? world.env["USERNAME"] ?? "the person at the terminal", words: answer.trim(), at }
}

async function install(ctx: Context, world: ToolsWorld, name: string, words: string | undefined, by: string | undefined): Promise<number> {
  const { platform, dir } = machine(world)
  const plan = planOf(ctx, world, name)
  for (const l of planLines(plan)) ctx.out(l)
  const blocked = plan.find((s) => s.unavailable && !s.installed)
  if (blocked) throw refuse(`${blocked.tool} cannot be installed on ${platform}: ${blocked.unavailable}`)
  if (plan.every((s) => s.installed)) {
    ctx.out(`${name} ${declOf(ctx, name).version} is already installed: ${installDirOf(dir, declOf(ctx, name))}`)
    return EXIT.OK
  }
  const consent = await consentFor(world, words, by, plan, `naima tools install ${name}`)
  const todo = plan.filter((x) => !x.installed)
  const progress = progressFor((l) => ctx.err(l))
  try {
    for (const [i, s] of todo.entries()) {
      if (todo.length > 1) progress.overall(i, todo.length, "tools")
      const decl = declOf(ctx, s.tool)
      const source = decl.platforms[platform as keyof ToolDeclaration["platforms"]] as Source
      const pythonDecl = source.python ? declOf(ctx, source.python) : null
      const python = pythonDecl ? installedAt(dir, pythonDecl, platform, world.os) : null
      const pythonSource = pythonDecl?.platforms[platform as keyof ToolDeclaration["platforms"]] as Source | undefined
      const target = await installTool(decl, source, {
        dir,
        platform,
        os: world.os === "win32" ? "windows" : world.os,
        exec: world.exec,
        consent,
        python: python && pythonSource ? join(python, pythonSource.bin, programFile("python", world.os)) : null,
        out: (l) => ctx.out(l),
        progress,
      })
      ctx.out(`installed ${decl.name} ${decl.version}: ${target}`)
    }
  } finally {
    progress.end()
  }
  return EXIT.OK
}

function remove(ctx: Context, world: ToolsWorld, name: string): number {
  const { platform, dir } = machine(world)
  const path = join(dir, name)
  if (!existsSync(path)) {
    ctx.out(`${name} is not installed here (${dir}): nothing to remove`)
    return EXIT.OK
  }
  const dependents = declared(ctx).filter(({ decl }) => (decl.needs ?? []).includes(name) && existsSync(join(dir, decl.name)))
  if (dependents.length) {
    const names = dependents.map((d) => d.decl.name)
    throw refuse(`${name} is needed by ${names.join(", ")}, installed here — naima tools remove ${names[0]} first; nothing removed`)
  }
  const versions = readdirSync(path)
  rmSync(path, { recursive: true, force: true })
  ctx.out(`removed ${name} (${versions.join(", ") || "no version"}) from ${dir} on ${platform}`)
  return EXIT.OK
}

function pathOf(ctx: Context, world: ToolsWorld, name: string, program: string | undefined): number {
  const { platform, dir } = machine(world)
  const decl = declOf(ctx, name)
  const p = program ?? decl.programs[0]!
  if (!decl.programs.includes(p)) throw refuse(`${name} provides ${decl.programs.join(", ")}, not ${p}`)
  const at = installedAt(dir, decl, platform, world.os)
  if (!at) throw refuse(`${name} ${decl.version} is not installed here — naima tools install ${name}`)
  const source = decl.platforms[platform as keyof ToolDeclaration["platforms"]] as Source
  ctx.out(join(at, source.bin, programFile(p, world.os)))
  return EXIT.OK
}

/** The hosts the long-work plugin declares: the same machines `naima run --host` reaches. */
function hostNamed(ctx: Context, name: string): Host {
  const hosts = projectHosts(ctx.config.plugins["long-work"]?.options ?? {})
  const h = hosts.get(name)
  if (!h) {
    throw refuse(
      noHost(name, hosts),
    )
  }
  return h
}

function relay(ctx: Context, host: Host, r: { out: string; err: string }): void {
  for (const l of r.out.split("\n").filter(Boolean)) ctx.out(`${host.name}: ${l}`)
  for (const l of r.err.split("\n").filter(Boolean)) ctx.err(`${host.name}: ${l}`)
}

/** `--host`: the host's own Naima answers; an install asks its plan first and the consent here (§7). */
async function onHost(ctx: Context, world: ToolsWorld, host: Host, sub: string | undefined, rest: string[], words: string | undefined, by: string | undefined) {
  if (sub !== "install") {
    const r = askHost(host, ["tools", ...(sub ? [sub] : []), ...rest])
    relay(ctx, host, r)
    return r.code
  }
  const name = rest[0]!
  const asked = askHost(host, ["tools", "show", name, "--json"])
  let plan: PlanStep[]
  try {
    plan = JSON.parse(asked.out) as PlanStep[]
  } catch {
    relay(ctx, host, asked)
    throw refuse(
      `${host.name} (${host.ssh}) did not give its plan for ${name} (exit ${asked.code}) — its own Naima must have the tools plugin and the plugin declaring ${name}`,
    )
  }
  for (const l of planLines(plan, `${host.name} (${host.ssh})`)) ctx.out(l)
  const blocked = plan.find((s) => s.unavailable && !s.installed)
  if (blocked) throw refuse(`${blocked.tool} cannot be installed on ${host.name}: ${blocked.unavailable}`)
  if (plan.every((s) => s.installed)) {
    ctx.out(`${name} is already installed on ${host.name}`)
    return EXIT.OK
  }
  const consent = await consentFor(world, words, by, plan, `naima tools install ${name} --host ${host.name}`)
  const r = askHost(host, ["tools", "install", name, "--consent", consent.words, "--by", consent.by], 3_600_000)
  relay(ctx, host, r)
  return r.code
}

const toolsCommand = (world: () => ToolsWorld): Command => ({
  name: "tools",
  says:
    "the tools the loaded plugins declare, on this machine or a declared host: what is installed, missing or unavailable; show what an install would fetch; install one with consent into Naima's own directory, its download checked and the tool verified, never touching PATH or the system; remove one; print an installed program's path",
  enforces:
    "an install fetches only the declared source, refuses a size or sha256 that differs, keeps nothing that fails its verification, and goes on only with consent — a yes on a terminal, or --consent with --by, recorded in the receipt; nothing is written outside the tools directory; a tool another installed tool needs is not removed",
  long: {
    reports:
      "install: the stage download with the bytes received of the declared size, its rate and ETA; then unpack and verify, without a count; with tools it needs, the tools installed of those to install",
  },
  usage:
    'tools [--json] [--host <h>] | tools show <tool> [--json] [--host <h>] | tools install <tool> [--consent "<the yes, restated>" --by <who>] [--host <h>] | tools remove <tool> [--host <h>] | tools path <tool> [<program>]',
  options: [
    { name: "--json", says: "print the report, or the plan, as JSON" },
    { name: "--host", says: "ask this host, declared in the long-work plugin's hosts option, through its own Naima over ssh" },
    { name: "--consent", says: "the yes of the person whose machine it is, restated: an install without a terminal needs it" },
    { name: "--by", says: "who gave the consent: needed with --consent" },
  ],
  examples: [
    "tools",
    "tools show mcrl2",
    "tools install mcrl2",
    'tools install storm --consent "yes, install Storm" --by owner',
    "tools install mcrl2 --host lab",
    "tools remove storm",
    "tools path storm python",
  ],
  run(args, ctx) {
    const p = parse(args, { json: { type: "boolean" }, host: { type: "string" }, consent: { type: "string" }, by: { type: "string" } })
    const [sub, ...rest] = p.positionals
    const w = world()
    const words = str(p, "consent")
    const by = str(p, "by")
    if (sub !== undefined && !["show", "install", "remove", "path"].includes(sub)) throw usageError(this)
    if ((sub === "show" || sub === "install" || sub === "remove") && rest.length !== 1) throw usageError(this)
    if (sub === "path" && (rest.length < 1 || rest.length > 2)) throw usageError(this)
    const hostName = str(p, "host")
    if (hostName !== undefined) {
      if (sub === "path") throw refuse("naima tools path answers for this machine only")
      return onHost(ctx, w, hostNamed(ctx, hostName), sub, [...rest, ...(bool(p, "json") ? ["--json"] : [])], words, by)
    }
    if (sub === "show") {
      const plan = planOf(ctx, w, rest[0]!)
      if (bool(p, "json")) ctx.out(JSON.stringify(plan, null, 2))
      else for (const l of planLines(plan)) ctx.out(l)
      return EXIT.OK
    }
    if (sub === "install") return install(ctx, w, rest[0]!, words, by)
    if (sub === "remove") return remove(ctx, w, rest[0]!)
    if (sub === "path") return pathOf(ctx, w, rest[0]!, rest[1])
    const r = report(ctx, w)
    if (bool(p, "json")) {
      ctx.out(JSON.stringify(r, null, 2))
      return EXIT.OK
    }
    ctx.out(`tools on this machine (${r.platform}), in ${r.dir}:`)
    if (!r.tools.length) ctx.out("  no loaded plugin declares a tool")
    const nameWidth = Math.max(8, ...r.tools.map((t) => t.name.length))
    const versionWidth = Math.max(10, ...r.tools.map((t) => t.version.length))
    for (const t of r.tools) {
      const state = t.state === "installed"
        ? "installed"
        : t.state === "missing"
        ? `missing — ${t.install}`
        : t.state === "unavailable"
        ? `unavailable here — ${t.answer}`
        : `no declaration for ${r.platform}`
      ctx.out(
        `  ${t.name.padEnd(nameWidth)} ${t.version.padEnd(versionWidth)} ${state}${
          t.other?.length ? ` (also installed: ${t.other.join(", ")})` : ""
        }  [${t.plugin}]`,
      )
    }
    return EXIT.OK
  },
})

/** Read a receipt, or null: for the tests and the report. */
export function readReceipt(path: string): Receipt | null {
  try {
    return JSON.parse(readFileSync(join(path, RECEIPT), "utf8")) as Receipt
  } catch {
    return null
  }
}

/** The plugin, its world given: tests hand it stand-ins for the terminal and the programs. */
export function toolsPlugin(world: () => ToolsWorld = realWorld): Plugin {
  return {
    name: "tools",
    contract: CONTRACT,
    says:
      "the tools plugins need, installed by Naima into its own directory on the machine it runs on: naima tools reports them, installs one with consent, removes one",
    about:
      "A plugin declares each tool it needs under `contributes.tools`: an exact version, a licence, its programs, how an install is verified, and per platform a source — url, size, sha256, format — or the answer saying why there is none. " +
      "`naima tools` reports, for this machine, each declared tool as installed, missing or unavailable. `naima tools install <tool>` prints the plan — the tool and those it needs, each with source, size and licence — and goes on only with consent: a yes on a terminal, or `--consent` with `--by`, recorded in the receipt. " +
      "It downloads into a staging directory, checks the size and the sha256, unpacks with the platform's own programs (`tar`, `hdiutil`; a `.deb` without dpkg; a `pip` source into a venv, hash-checked), runs the declared check, and renames the install into `<dir>/<tool>/<version>`. " +
      "The directory is `$NAIMA_TOOLS`, or `~/Library/Application Support/naima/tools` (macOS), `~/.local/share/naima/tools` (Linux), `%LOCALAPPDATA%\\naima\\tools` (Windows): nothing goes on PATH or into the system, and deleting it removes every tool. " +
      "A plugin finds an installed program with `installedProgram`. `--host` asks a host the long-work plugin declares, through its own Naima; an install there shows its plan and asks the consent here.",
    points: [toolsPoint],
    commands: [toolsCommand(world)],
  }
}

export default function tools(): Plugin {
  return toolsPlugin()
}
