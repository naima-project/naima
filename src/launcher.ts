// The launcher: the one piece of Naima that runs with every permission, and
// all it does is work out where things are, then run the program under Deno
// with only these (docs/guide/install.md says why each one exists):
//
//   read    the repository, the program wherever it is, and the data directory of every other worktree
//   write   the tracker folder (naima-tracker/, the parent of the program), and the data and program if moved out of it;
//           the tick's state, naima/ in the clone's git directory (core/tick.ts), which it reads too;
//           for init and update, the entry files and the session-start settings of the agent tools in use (session-start.ts)
//   run     git, tar (to unpack a release's archive), and the programs the loaded contributions declare (`runs`: a verifier's
//           tool, a metric's command), nothing else
//   env     an allow-list of the environment (ENV below): what git needs, and Naima's own,
//           plus the machine's name and the private word list (core/private.ts), read here
//   net     GitHub's API host, to ask whether the tracker's remotes are public (at most once a day) and to read releases,
//           and the hosts a release's archive is downloaded from (core/releases.ts), or the server NAIMA_RELEASES_API names;
//           otherwise the network is git's, for alignment and update — except for `naima ui` (UI below)
//
// `naima ui`, and no other command, may also listen on the loopback interface,
// read and run the Deno that runs it — to open its window, a process of its
// own with the webview's permissions (src/plugins/ui/open.ts) — and run the
// program that opens the default browser. `naima run` and `naima wait`, and no
// other command, may read and run that Deno too — to start a run's supervisor,
// a process of its own (src/plugins/long-work/supervisor.ts) — and run ssh,
// to reach a host; and they are handed the whole environment, which a run's
// command inherits as the caller's. `naima verify`, and no other command, may
// run naima-codegen, the program of the first-party naima-codegen verifier
// (VERIFY_PROGRAM), and with --host ssh too, to run the verifier in the host's
// checkout. Every command may read the tools
// directory, where an installed tool's programs are (src/core/tools.ts);
// `naima tools`, and `naima backup create`, which installs gh through it, and no
// other command, may write it, use the network and run any program: an install
// downloads from a host a redirect chooses, and runs unpackers, a Python and the
// tool it verifies, none of which exists when the launcher starts.
//
// The data is the program's sibling, `dirname(program)/naima-data`, unless
// --data or NAIMA_DATA names it. When the program exits with RELAUNCH it has
// just aligned the program directory, so the code on disk is not the code
// that ran: the launcher runs the program directory's own code, which is the
// locked commit.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  ADAPTERS,
  apiHost,
  DATA_DIR,
  DATA_FILE,
  DEFAULT_ENTRY_FILES,
  EXCLUDE_FILES,
  findData,
  globalOptions,
  launcherSet,
  message,
  pluginHookPaths,
  privateEnv,
  programOf,
  readConfig,
  real,
  RELAUNCH,
  RELEASE_HOSTS,
  releasesApi,
  restoreDeleted,
  restoredFiles,
  runtimeOf,
  type SessionConfig,
  sessionStartPaths,
  tickDir,
  toolsDir,
  toplevel,
  TRACKER_DIR,
  trackerOf,
  VISIBILITY_HOST,
  worktrees,
} from "./core/internal.ts"

/** Alignment, an update and its migration: at most three hand-overs, and one to spare. */
const MAX_RUNS = 4

/**
 * The environment the program is handed; nothing else reaches it, nor the git
 * it runs. Naima reads only NAIMA_*; the rest is what git, ssh and a proxy
 * need to reach a source, and what Deno needs to run. Deno cannot grant a
 * named list and still let node:child_process hand git its environment, so
 * the list is enforced by giving the program only these variables.
 */
export const ENV = {
  names: [
    "HOME",
    "USER",
    "LOGNAME",
    "PATH",
    "SHELL",
    "TERM",
    "LANG",
    "TZ",
    "TMPDIR",
    "TMP",
    "TEMP",
    "NO_COLOR",
    "FORCE_COLOR",
    "DISPLAY",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "XDG_RUNTIME_DIR",
    "GNUPGHOME",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "ALL_PROXY",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "HOMEDRIVE",
    "HOMEPATH",
    "PROGRAMDATA",
  ],
  prefixes: ["NAIMA_", "GIT_", "SSH_", "LC_", "DENO_"],
} as const

/** The variables of `env` the program may see: ENV's names and prefixes, compared as Windows does, without case. */
export function allowedEnv(env: Record<string, string>): Record<string, string> {
  // And the variables that tell which agent tool the program runs inside, so init installs that tool's hooks.
  const names = new Set<string>([...ENV.names, ...ADAPTERS.flatMap((a) => a.env ?? [])])
  const keep = (name: string): boolean => names.has(name.toUpperCase()) || ENV.prefixes.some((p) => name.toUpperCase().startsWith(p))
  return Object.fromEntries(Object.entries(env).filter(([name]) => keep(name)))
}

/** What one command is granted besides the rest: `naima ui`'s, `naima run`'s and `naima wait`'s, or `naima tools`'. */
export interface UiGrant {
  net: string[]
  read: string[]
  runs: string[]
  /** Directories it may write besides the tracker folder. */
  write?: string[]
  /** Any host, any program: what an install needs (`naima tools`). */
  netAll?: boolean
  runAll?: boolean
  /** Hand the program the whole environment rather than ENV's: a run's command inherits it as the caller's. */
  wholeEnv?: boolean
}

/** The program that opens the default browser, by operating system: the same src/plugins/ui/open.ts starts. */
export const BROWSER_OPENER: Record<string, string> = { darwin: "open", windows: "rundll32", linux: "xdg-open" }

/** The program `naima verify` may start besides the loaded contributions' `runs`: the verifier plugin's naima-codegen adapter's, found on PATH. Kept equal to that adapter's `CODEGEN_PROGRAM` by a test. */
export const VERIFY_PROGRAM = "naima-codegen"

/** naima-codegen as PATH finds it, and the file it links to, which `naima verify` may read: none when it is not on PATH. */
function codegenFiles(): string[] {
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (!dir) continue
    const file = join(dir, VERIFY_PROGRAM)
    try {
      // A path with a comma cannot be granted (Deno splits on commas): the version then says the commit is unknown.
      if (statSync(file).isFile()) return [...new Set([file, realpathSync(file)])].filter((f) => !f.includes(","))
    } catch { /* not here: the next directory */ }
  }
  return []
}

/** The grant of `command`: only `ui`, `run`, `wait`, `tools`, `backup create`, `verify`, `stance adopt` and `guard server` have one; `tools` is the tools directory to write; `rest`, the arguments after the command. */
export function uiGrant(command: string | undefined, os: string, deno: string, tools: string | null = null, rest: readonly string[] = []): UiGrant | null {
  // gh only for guard server, which sends the ruleset; --print sends nothing.
  if (command === "guard") return rest[0] === "server" && !rest.includes("--print") ? { net: [], read: [], runs: ["gh"] } : null
  // naima-codegen, the verifier plugin's naima-codegen adapter (adapters/naima-codegen.ts): a first-party verifier's program, granted to verify alone.
  if (command === "verify") {
    return {
      net: [],
      // The program itself, and the file it links to: the adapter reads where it is to find the commit it runs from.
      read: codegenFiles(),
      runs: [
        VERIFY_PROGRAM,
        ...(rest.some((a) => a === "--host" || a.startsWith("--host=")) ? ["ssh"] : []),
      ],
    }
  }
  if (command === "tools") return { net: [], read: [], runs: [], write: tools ? [tools] : [], netAll: true, runAll: true }
  // naima backup create installs gh through the tools plugin, as naima tools install does, then runs it: the same grant.
  if (command === "backup" && rest[0] === "create") return { net: [], read: [], runs: [], write: tools ? [tools] : [], netAll: true, runAll: true }
  // naima stance adopt runs the adoption a stance declares, which starts the programs it names (the UI stance's, Deno): the stance is not loaded yet when the grant is made.
  if (command === "stance" && rest[0] === "adopt") return { net: [], read: [], runs: [], runAll: true }
  // On Windows `naima run` starts its supervisor through WMI, by PowerShell (src/plugins/long-work/launch.ts).
  if (command === "run" || command === "wait") {
    return { net: [], read: [deno], runs: [deno, "ssh", ...(command === "run" && os === "windows" ? ["powershell.exe"] : [])], wholeEnv: true }
  }
  if (command !== "ui") return null
  return { net: ["127.0.0.1"], read: [deno], runs: [deno, BROWSER_OPENER[os] ?? "xdg-open"] }
}

/**
 * The permissions the program runs with, as Deno flags. Throws when a path cannot be said in one: Deno splits the lists on commas.
 * `worktrees` are the other worktrees' data directories: read-only, and one with a comma is left out — it is read from its branch.
 */
export function permissions(
  p: {
    root: string
    tracker: string
    data: string | null
    program: string
    entry: string
    hostFiles?: string[]
    worktrees?: string[]
    /** The programs the loaded contributions start, besides git: a verifier's `runs`, a metric's program. */
    runs?: string[]
    /** What `naima ui` is granted besides: null for every other command. */
    ui?: UiGrant | null
    /** The tools directory, which every command may read: null when there is none. */
    tools?: string | null
    /** Hosts the command may reach besides: init asks GitHub whether the project is public. */
    net?: string[]
    /** The tick's state folder in the clone's git directory, read and written by every command: null outside git. */
    tick?: string | null
  },
): string[] {
  const list = (paths: (string | null)[]) => {
    const all = [...new Set(paths.filter((x): x is string => x !== null).map(real))]
    const comma = all.find((x) => x.includes(","))
    if (comma) {
      throw new Error(
        `the path ${comma} holds a comma, which Deno's permission flags cannot express (they split on commas) — move the project, or the program, to a path without one`,
      )
    }
    return all.join(",")
  }
  // A tools directory Deno cannot name is left out: no command reads it, and `naima tools` says why.
  const tools = p.tools && !real(p.tools).includes(",") ? [p.tools] : []
  // So is a tick folder: the commands then run without a tick.
  const tick = p.tick && !real(p.tick).includes(",") ? [p.tick] : []
  return [
    `--allow-read=${
      list([p.root, p.data, p.program, p.entry, ...(p.worktrees ?? []).map(real).filter((x) => !x.includes(",")), ...(p.ui?.read ?? []), ...tools, ...tick])
    }`,
    `--allow-write=${list([p.tracker, p.data, p.program, ...tick, ...(p.hostFiles ?? []), ...(p.ui?.write ?? []).filter((w) => tools.includes(w))])}`,
    p.ui?.runAll ? "--allow-run" : `--allow-run=${[...new Set(["git", "tar", ...(p.runs ?? []), ...(p.ui?.runs ?? [])])].join(",")}`,
    "--allow-env",
    ...(p.ui?.netAll
      ? ["--allow-net"]
      : p.ui?.net.length || p.net?.length
      ? [`--allow-net=${[...new Set([...(p.ui?.net ?? []), ...(p.net ?? [])])].join(",")}`]
      : []),
  ]
}

/**
 * The data directory of every other worktree of the project, where each one's uncommitted records are: the
 * cross-branch views read them from disk (docs/agents/worktree-isolation.md). Only when the data is inside the project.
 */
function otherWorktrees(root: string, data: string | null): string[] {
  if (!data) return []
  const inside = relative(real(root), real(data))
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) return []
  return worktrees(root).filter((w) => !w.self).map((w) => join(w.path, inside))
}

/** The first-party plugins loaded only when the project's plugins table names them: each starts a program. Kept equal to builtins.ts's `optIn` by a test. */
export const OPT_IN: readonly string[] = ["verifier-mcrl2", "storm"]

/** An entry of the plugins table that switches its plugin on: present, and not `enabled: false`. */
const isOn = (e: unknown): boolean => !!e && typeof e === "object" && (e as { enabled?: unknown }).enabled !== false

/**
 * May the loaded contributions start a program besides git? Only when the
 * project loads code the program does not ship — a third-party plugin, or a
 * replacement for a first-party one — or declares metrics or test suites, each
 * naming the program that measures it, or switches on a first-party plugin that is off
 * until asked for (`OPT_IN`), each starting a model checker: no other
 * first-party contribution starts one.
 * Read in every format: a list of plugins (format 1), or a table whose entries
 * name a source or a replacement, or give the metrics plugin metrics.
 */
export function mayRun(data: string | null): boolean {
  if (!data) return false
  try {
    const plugins = (JSON.parse(readFileSync(join(data, DATA_FILE), "utf8")) as { plugins?: unknown }).plugins
    if (Array.isArray(plugins)) return plugins.length > 0
    if (!plugins || typeof plugins !== "object") return false
    const options = (plugins as { metrics?: { options?: { metrics?: unknown; suites?: unknown } } }).metrics?.options
    for (const declared of [options?.metrics, options?.suites]) if (declared && typeof declared === "object" && Object.keys(declared).length) return true
    const entries = plugins as Record<string, unknown>
    if (OPT_IN.some((name) => isOn(entries[name]))) return true
    return Object.values(plugins).some((e) => !!e && typeof e === "object" && ("source" in e || "replacedBy" in e))
  } catch {
    return false
  }
}

/**
 * The programs the loaded contributions declare they start, asked of the program
 * that is about to run (`naima runs --json`), under the same read permission
 * and nothing else: no write, no network, and git alone to run. Asked only
 * when the project loads third-party plugins; an answer that is not a list of
 * names is no programs.
 */
function declaredRuns(entry: string, cwd: string, read: string, env: Record<string, string>): string[] {
  const { NAIMA_LAUNCHED: _launched, ...probeEnv } = env
  const r = new Deno.Command(Deno.execPath(), {
    args: ["run", "--no-prompt", "--no-config", "--no-lock", read, "--allow-run=git", "--allow-env", join(entry, "src", "cli.ts"), "runs", "--json"],
    cwd,
    clearEnv: true,
    env: probeEnv,
    stdin: "null",
    stdout: "piped",
    stderr: "null",
  }).outputSync()
  if (!r.success) return []
  try {
    const list: unknown = JSON.parse(new TextDecoder().decode(r.stdout))
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string" && /^[^\s,]+$/.test(x)) : []
  } catch {
    return []
  }
}

/** The project's configured `entryFiles` and `agents`, or the defaults: `data` may hold no naima.json yet, or one this Naima cannot parse. */
function sessionConfigOf(data: string | null): SessionConfig {
  if (!data || !existsSync(join(data, DATA_FILE))) return { entryFiles: DEFAULT_ENTRY_FILES }
  try {
    return readConfig(data)
  } catch {
    return { entryFiles: DEFAULT_ENTRY_FILES }
  }
}

/** The host files the run may write outside the tracker folder: only init's and update's, the pointer line and the session-start hooks, init --write-excludes's, and stance adopt's, the settings its hooks go to. */
export function hostFiles(rest: string[], root: string, data: string | null): string[] {
  const [command, ...args] = rest
  // naima stance adopt installs the hooks the stance contributes, and writes nothing else of the host's.
  if (command === "stance" && args[0] === "adopt") return pluginHookPaths(root, sessionConfigOf(data))
  if (command !== "init" && command !== "update") return []
  const config = sessionConfigOf(data)
  const hooks = !(command === "init" && args.includes("--no-session-hook"))
  return [
    ...(command === "init" && args.includes("--write-excludes") ? EXCLUDE_FILES.map((f) => join(root, f)) : []),
    ...sessionStartPaths(root, config, { hooks }),
  ]
}

/** The tick's state folder, naima/ in the clone's git directory: null outside git. */
function tickFolder(root: string): string | null {
  try {
    const dir = tickDir(root)
    return dir ? dirname(dir) : null
  } catch {
    return null
  }
}

/** The nearest directory of `path`, or above it, that exists: what git can be asked about. */
function existing(path: string): string {
  let dir = resolve(path)
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir)
  return dir
}

/** The data of the project `cwd` is in, when it is not the one this launcher's program belongs to; else undefined. */
export function otherProject(cwd: string, own: string): string | undefined {
  const here = toplevel(cwd)
  if (!here || real(here) === real(toplevel(dirname(own)) ?? dirname(own))) return undefined
  const data = join(here, TRACKER_DIR, DATA_DIR)
  return existsSync(join(data, DATA_FILE)) ? data : undefined
}

export async function launch(args: string[], cwd: string): Promise<number> {
  let parsed: ReturnType<typeof globalOptions>
  try {
    parsed = globalOptions(args)
  } catch {
    parsed = { rest: args } // the program says what is wrong with the arguments
  }
  // Resolved: Deno grants real paths, and the program reads its own directory, which may not be the project's.
  const own = real(dirname(dirname(fileURLToPath(import.meta.url))))
  // Run from inside another project that uses Naima — a fresh clone, whose program is not cloned yet — the
  // launcher serves that project, as if named with --data: the data says where its program goes, and it is cloned.
  const given = parsed.data ?? Deno.env.get("NAIMA_DATA") ?? otherProject(cwd, own)
  const data = findData(cwd, own, given)
  // Named, the data says where its program is; beside the program, the data is the program's own and the parent folder bounds the writes.
  const program = given && existsSync(join(data, DATA_FILE)) ? programOf(data) : own
  const tracker = given ? trackerOf(data) : dirname(own)
  const root = toplevel(existing(tracker)) ?? resolve(cwd)
  // The machine's name and the private word list, which the program may not ask for itself: what tracker text is checked against.
  const marks = {
    ...privateEnv(Deno.env.toObject(), Deno.build.os),
    NAIMA_LAUNCHED: "1",
    ...(given ? { NAIMA_DATA: real(data) } : {}),
  }
  // Which of them are the launcher's alone, so a command the program starts is handed the caller's environment without them.
  const env = { ...allowedEnv(Deno.env.toObject()), ...marks, NAIMA_LAUNCHER_SET: launcherSet(marks, Deno.env.toObject()) }
  const others = otherWorktrees(root, data)
  const tools = toolsDir(Deno.env.toObject(), Deno.build.os)
  // The tick's state, naima/ in the clone's git directory, shared by its worktrees; the program is told its tick/ folder.
  const tickState = tickFolder(root)
  const ui = uiGrant(parsed.rest[0], Deno.build.os, Deno.execPath(), tools, parsed.rest.slice(1))
  // A program whose own entry is gone cannot repair itself: when files deleted from its clone are all that differs, git restores them.
  if (!runtimeOf(program)) {
    const restored = restoreDeleted(program)
    if (restored) console.error(`naima: ${restoredFiles(restored, relative(root, program).split("\\").join("/"))}`)
  }
  let entry = real(runtimeOf(program) ?? own)
  for (let run = 0; run < MAX_RUNS; run++) {
    let flags: string[]
    try {
      const fence = {
        root,
        tracker,
        data,
        program,
        entry,
        hostFiles: hostFiles(parsed.rest, root, data),
        worktrees: others,
        tools,
        tick: tickState,
        // Every command: the tracker's privacy is asked of GitHub at most once a day, before the first write (core/exposure.ts).
        // And releases: read from the API, their archives downloaded where it redirects them, when an install or update needs one.
        net: [VISIBILITY_HOST, ...RELEASE_HOSTS, ...[apiHost(releasesApi(Deno.env.toObject()))].filter((h): h is string => !!h)],
      }
      const read = permissions(fence)[0] ?? ""
      flags = permissions({ ...fence, runs: mayRun(data) ? declaredRuns(entry, cwd, read, env) : [], ui })
    } catch (e) {
      console.error(`naima: ${message(e)}`)
      return 2
    }
    const child = new Deno.Command(Deno.execPath(), {
      args: ["run", "--no-prompt", "--no-config", "--no-lock", ...flags, join(entry, "src", "cli.ts"), ...args],
      cwd,
      clearEnv: true,
      env: { ...(ui?.wholeEnv ? { ...Deno.env.toObject(), ...env } : env), ...(tickState ? { NAIMA_TICK_DIR: join(tickState, "tick") } : {}) },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn()
    // Ctrl-C reaches the program too, which stops `naima ui`'s server and says how it ended: wait for it.
    const wait = () => {}
    if (ui) Deno.addSignalListener("SIGINT", wait)
    const { code } = await child.status
    if (ui) Deno.removeSignalListener("SIGINT", wait)
    if (code !== RELAUNCH) return code
    entry = real(runtimeOf(program) ?? program) // resolved, as the permissions name it: the program may have just been made
  }
  console.error(`naima: ${program} did not settle after ${MAX_RUNS} runs — its alignment keeps moving`)
  return 2
}
