// Where `naima ui` shows its server: a native window when it can open one,
// the default browser when it cannot — or when asked to. The window is
// window.ts, run by Deno in a process of its own with only what the webview
// needs: native code from, read and written in, the binding's cache in Deno's
// directory; the network to fetch the binding's library once, from its
// release on GitHub; and the environment, where the binding finds that cache.

import { spawn } from "node:child_process"
import { join, posix, win32 } from "node:path"
import { fileURLToPath } from "node:url"

/** The webview binding window.ts loads, pinned: a different version is a change to review, never a drift. */
export const WEBVIEW = "jsr:@webview/webview@0.9.0"

/** window.ts's exit code when the webview does not load. */
export const NOT_LOADED = 3

/** Where the webview binding's library comes from on its first run: its release on GitHub, and the hosts GitHub sends the download to. */
export const LIBRARY_HOSTS = ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]

/** How long the window may take to say it is open: the first run fetches the binding and its library. */
export const READY_MS = 120_000

const WINDOW = fileURLToPath(new URL("./window.ts", import.meta.url))

/** The program that opens a URL in the default browser, by operating system: rundll32 rather than `start`, which is cmd's and parses the URL. */
export function browserCommand(os: string, url: string): [string, ...string[]] {
  if (os === "darwin") return ["open", url]
  if (os === "windows") return ["rundll32", "url.dll,FileProtocolHandler", url]
  return ["xdg-open", url]
}

/** The Deno that runs this program, or null on Node and Bun. */
export function denoPath(): string | null {
  const d = (globalThis as { Deno?: { execPath(): string } }).Deno
  if (!d) return null
  try {
    return d.execPath()
  } catch {
    return null
  }
}

/** The operating system, as Deno names it. */
export function osName(): string {
  return process.platform === "win32" ? "windows" : process.platform
}

/** Deno's directory, where the webview binding keeps its library (in `plug/`): DENO_DIR, or the platform's cache directory. From the environment: the program may not ask the system. */
export function denoDir(env: Record<string, string | undefined>, os: string, home = env["HOME"] ?? env["USERPROFILE"] ?? "."): string {
  if (env["DENO_DIR"]) return env["DENO_DIR"]
  // Paths in the form of the system asked about, whatever system this runs on.
  const at = os === "windows" ? win32.join : posix.join
  if (os === "darwin") return at(home, "Library", "Caches", "deno")
  if (os === "windows") return at(env["LOCALAPPDATA"] ?? at(home, "AppData", "Local"), "deno")
  return at(env["XDG_CACHE_HOME"] ?? at(home, ".cache"), "deno")
}

/** Why no window can open here, or null when one may: the window is Deno's, on macOS, Linux and Windows. */
export function windowUnavailable(deno: string | null, os: string): string | null {
  if (!deno) return "the window needs Deno, and this is Node or Bun"
  if (!["darwin", "linux", "windows"].includes(os)) return `the window does not run on ${os}`
  return null
}

/** The command line that opens the window on `url`: Deno, its permissions, window.ts. */
export function windowCommand(deno: string, url: string, dir: string): string[] {
  const plug = join(dir, "plug")
  return [
    deno,
    "run",
    "--no-prompt",
    "--no-config",
    "--no-lock",
    `--allow-ffi=${plug}`,
    `--allow-read=${dir}`,
    `--allow-write=${plug}`,
    `--allow-net=${LIBRARY_HOSTS.join(",")}`,
    "--allow-env",
    WINDOW,
    url,
    "Naima",
  ]
}

export type Opened =
  | { opened: true; how: "window"; closed: Promise<void>; stop(): void }
  | { opened: true; how: "browser" }
  | { opened: false; reason: string }

/** Open the native window on `url` and resolve once it says it is open, or with the reason it did not. */
export function openWindow(command: string[], readyMs = READY_MS): Promise<Opened> {
  const [program, ...args] = command
  return new Promise((resolve) => {
    let settled = false
    let err = ""
    const child = spawn(program!, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } })
    const closed = new Promise<void>((done) => child.once("exit", () => done()))
    const settle = (o: Opened) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(o)
    }
    const timer = setTimeout(() => {
      child.kill()
      settle({ opened: false, reason: `the window did not open within ${Math.round(readyMs / 1000)} s` })
    }, readyMs)
    child.stdout.on("data", (b) => {
      if (String(b).includes("ready")) settle({ opened: true, how: "window", closed, stop: () => child.kill() })
    })
    child.stderr.on("data", (b) => (err += String(b)))
    child.once("error", (e) => settle({ opened: false, reason: e.message }))
    child.once("exit", (code) => {
      // Deno's own lines (its downloads, uncoloured by NO_COLOR) are not the reason: the last line the window said is.
      const said = err.split("\n").map((l) => l.trim()).filter((l) => l && !/^(Download|Downloading)\b/.test(l)).at(-1)
      settle({ opened: false, reason: said ?? (code === NOT_LOADED ? "the webview did not load" : `the window exited with ${code}`) })
    })
  })
}

/** Open `url` in the default browser. */
export function openBrowser(command: [string, ...string[]]): Promise<Opened> {
  const [program, ...args] = command
  return new Promise((resolve) => {
    const child = spawn(program, args, { stdio: "ignore", detached: true })
    child.once("error", (e) => resolve({ opened: false, reason: `${program}: ${e.message}` }))
    child.once("spawn", () => {
      child.unref()
      resolve({ opened: true, how: "browser" })
    })
  })
}
