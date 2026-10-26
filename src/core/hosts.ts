// Hosts: the machines a long run or a tool install may go to, declared once in
// the long-work plugin's `hosts` option, and reached through one
// non-interactive ssh call per question that runs the host's own Naima
// (specs/long-work-naima-run-wait-run-list, §4; specs/tools-plugin-declares-tools-needs-naima-tools, §7).
// The command is quoted for the shell the host's sshd runs it through: a POSIX
// shell, or cmd, the shell of the stock Windows OpenSSH server.

import { spawnSync } from "node:child_process"

/** The shell a host's sshd runs a command through: a POSIX shell, or cmd (the stock Windows OpenSSH server). */
export type HostShell = "posix" | "cmd"
export const HOST_SHELLS: readonly HostShell[] = ["posix", "cmd"]

/** A declared host: where ssh reaches it, the project's checkout there, the command that runs its Naima from that checkout, and the shell its sshd runs. */
export interface Host {
  name: string
  ssh: string
  dir: string
  naima: string
  shell: HostShell
}

export const DEFAULT_REMOTE_NAIMA = "deno run -A naima-tracker/naima/naima.ts"
const HOST_NAME = /^[a-z0-9][a-z0-9-]*$/

/** The hosts `options.hosts` declares: name → { ssh, dir, naima?, shell? }. */
export function readHosts(options: Record<string, unknown>): Map<string, Host> {
  const raw = options["hosts"] ?? {}
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      'long-work: option hosts must be an object: host name → { "ssh": "<destination>", "dir": "<project on the host>", "naima": "<command>", "shell": "posix" | "cmd" }',
    )
  }
  const out = new Map<string, Host>()
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!HOST_NAME.test(name)) throw new Error(`long-work: host "${name}" must be named with lowercase letters, digits and dashes`)
    const h = (v && typeof v === "object" ? v : {}) as Partial<Host>
    if (typeof h.ssh !== "string" || !h.ssh.trim() || h.ssh.startsWith("-")) {
      throw new Error(`long-work: host "${name}" needs "ssh", the destination ssh is given (user@machine, or an alias), not starting with "-"`)
    }
    if (typeof h.dir !== "string" || !h.dir.trim()) throw new Error(`long-work: host "${name}" needs "dir", the project's checkout on the host`)
    if (h.naima !== undefined && (typeof h.naima !== "string" || !h.naima.trim())) {
      throw new Error(`long-work: host "${name}": "naima" must be the command that runs Naima there, from dir`)
    }
    if (h.shell !== undefined && !HOST_SHELLS.includes(h.shell)) {
      throw new Error(
        `long-work: host "${name}": "shell" is the shell its sshd runs a command through: ${
          HOST_SHELLS.map((x) => `"${x}"`).join(" or ")
        } (default "posix"; "cmd" for the stock Windows OpenSSH server)`,
      )
    }
    if (h.shell === "cmd" && h.dir.includes('"')) throw new Error(`long-work: host "${name}": "dir" holds a quote, which no Windows path can hold`)
    out.set(name, { name, ssh: h.ssh, dir: h.dir, naima: h.naima ?? DEFAULT_REMOTE_NAIMA, shell: h.shell ?? "posix" })
  }
  return out
}

/** One word for a POSIX shell, quoted only when it must be. */
export function shellQuote(word: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`
}

/**
 * One argument of a Windows command line, as a program that parses it by the
 * C runtime's rules (Deno, Node, most programs) reads it back: quoted only
 * when it must be (or `always`), each quote escaped with a backslash, and the
 * backslashes before a quote, or before the closing one, doubled.
 */
export function windowsArg(word: string, always = false): string {
  if (!always && word && !/[\s"]/.test(word)) return word
  return `"${word.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`
}

/** A Windows command line: each word by `windowsArg`, joined by spaces. */
export const windowsCommandLine = (words: string[]): string => words.map((w) => windowsArg(w)).join(" ")

/**
 * Text cmd passes on as written: each character cmd acts on (`&`, `|`, `<`,
 * `>`, `(`, `)`, `^`, `"`, `!`) escaped with `^`, and each `%` followed by an
 * escaped character, so no `%name%` is expanded (cmd leaves a variable it
 * does not know as written, then drops the caret). Quotes are escaped too, so
 * cmd never sees a quoted region, inside which its escapes would stop working.
 * A `%` must not end the text: quote it first (`cmdQuote` does).
 */
export function cmdEscape(text: string): string {
  return text.replace(/[&|<>()^"!]/g, "^$&").replace(/%(?!\^)/g, "%^")
}

/** One word for cmd, running a program that parses its command line by the C runtime's rules; a word with `%` is quoted, so no `%` ends it. */
export const cmdQuote = (word: string): string => cmdEscape(windowsArg(word, word.includes("%")))

/** The command the host's shell runs: into the checkout, then its Naima with `args`, each word quoted for that shell. */
export function remoteCommand(host: Host, args: string[]): string {
  if (host.shell === "cmd") {
    const dir = /[\s%]/.test(host.dir) ? `"${host.dir}"` : host.dir
    return `cd /d ${cmdEscape(dir)} && ${host.naima} ${args.map(cmdQuote).join(" ")}`
  }
  return `cd ${shellQuote(host.dir)} && ${host.naima} ${args.map(shellQuote).join(" ")}`
}

/** The arguments of the one ssh call that runs `naima <args>` in the host's checkout. */
export function sshArgs(host: Host, args: string[]): string[] {
  return ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host.ssh, remoteCommand(host, args)]
}

/** What a host's Naima answered one question: its exit status and output, or why ssh could not ask. */
export interface HostAnswer {
  ok: boolean
  out: string
  err: string
  code: number
}

/** Ask the host's Naima `args`, through one ssh call; its answer, or why there is none. */
export function askHost(host: Host, args: string[], timeoutMs = 120_000): HostAnswer {
  const r = spawnSync("ssh", sshArgs(host, args), { encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] })
  const err = r.error ? `ssh: ${r.error.message}` : String(r.stderr ?? "").trim()
  return { ok: r.status === 0, out: String(r.stdout ?? ""), err, code: r.status ?? 1 }
}
