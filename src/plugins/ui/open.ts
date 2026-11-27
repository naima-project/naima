// Where `naima ui` shows its server: a window of the system's webview opened from this Naima (src/window-main.ts), and the
// default browser when no window can be opened. The desktop app is the Tauri shell around the same bundle, with Naima as
// its sidecar, not this command.

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"

/** The program that opens a URL in the default browser, by operating system: rundll32 rather than `start`, which is cmd's and parses the URL. */
export function browserCommand(os: string, url: string): [string, ...string[]] {
  if (os === "darwin") return ["open", url]
  if (os === "windows") return ["rundll32", "url.dll,FileProtocolHandler", url]
  return ["xdg-open", url]
}

/** The operating system, as Deno names it. */
export function osName(): string {
  return process.platform === "win32" ? "windows" : process.platform
}

export type Opened = { opened: true } | { opened: false; reason: string }

/** Open `url` in the default browser. */
export function openBrowser(command: [string, ...string[]]): Promise<Opened> {
  const [program, ...args] = command
  return new Promise((resolve) => {
    const child = spawn(program, args, { stdio: "ignore", detached: true })
    child.once("error", (e) => resolve({ opened: false, reason: `${program}: ${e.message}` }))
    child.once("spawn", () => {
      child.unref()
      resolve({ opened: true })
    })
  })
}

/** The window's own program, beside this file. */
export const WINDOW_MAIN: string = fileURLToPath(new URL("../../window-main.ts", import.meta.url))

/** How long a window has to fail before it counts as open, in ms: a webview that cannot start ends within it. */
export const WINDOW_SETTLE_MS = 4_000

/** The command that opens `url` in a window titled `title`: Deno running window-main.ts with what the webview needs. */
export function windowCommand(deno: string, url: string, title: string): [string, ...string[]] {
  return [deno, "run", "--allow-ffi", "--allow-net", "--allow-read", "--allow-write", "--allow-env", WINDOW_MAIN, url, title]
}

/**
 * The webview libraries Naima builds for Linux systems the published one does not run on (that one needs GTK 4,
 * WebKitGTK 6 and glibc 2.33 or newer), each in webview/linux/<variant>/ beside this file: GTK 3 with WebKit2GTK 4.1,
 * then GTK 3 with WebKit2GTK 4.0 built on glibc 2.31. Tried in this order, and only once the published one failed, so
 * where it runs nothing changes. webview/build-linux.sh builds them.
 */
export const LINUX_WEBVIEWS: readonly string[] = ["gtk3-webkit41", "gtk3-webkit40"]

/** The folders of the Linux webview builds under `dir` that have a library for `arch` (x86_64, aarch64), as file URLs. */
export function linuxWebviews(dir: string, arch: string): string[] {
  return LINUX_WEBVIEWS.flatMap((v) => (existsSync(join(dir, v, `libwebview.${arch}.so`)) ? [`file://${join(dir, v)}/`] : []))
}

/** The browsers whose app mode (`--app=<url>`) opens a page in a window of its own, tried in this order on Linux. */
export const APP_BROWSERS: readonly string[] = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"]

/** The first of `names` found on `path` (the PATH's value), or null. */
export function onPath(names: readonly string[], path: string, exists: (p: string) => boolean = existsSync): string | null {
  for (const n of names) for (const d of path.split(delimiter)) if (d && exists(join(d, n))) return join(d, n)
  return null
}

/** Run the window's program once, with `env` added: open when it still runs after `settleMs`, else what it said. */
function tryWindow(url: string, title: string, settleMs: number, env: Record<string, string> = {}): Promise<Opened> {
  const [program, ...args] = windowCommand(process.execPath, url, title)
  return new Promise((resolve) => {
    const child = spawn(program, args, { stdio: ["ignore", "ignore", "pipe"], detached: true, env: { ...process.env, ...env } })
    let said = ""
    child.stderr?.on("data", (d: Buffer) => (said = (said + d.toString()).slice(-400)))
    const timer = setTimeout(() => {
      child.stderr?.destroy()
      child.unref()
      resolve({ opened: true })
    }, settleMs)
    child.once("error", (e) => {
      clearTimeout(timer)
      resolve({ opened: false, reason: `the window: ${e.message}` })
    })
    child.once("exit", (code) => {
      clearTimeout(timer)
      resolve({ opened: false, reason: `the window ended at once (exit ${code}): ${said.trim().split("\n").pop() ?? ""}` })
    })
  })
}

/** Open `url` in a browser's app mode, a window with no tabs or address bar: open once the browser started. */
function openAppWindow(browser: string, url: string): Promise<Opened> {
  return new Promise((resolve) => {
    const child = spawn(browser, [`--app=${url}`], { stdio: "ignore", detached: true })
    child.once("error", (e) => resolve({ opened: false, reason: `${browser}: ${e.message}` }))
    child.once("spawn", () => {
      child.unref()
      resolve({ opened: true })
    })
  })
}

/**
 * Open `url` in a window of the system's webview: open when the window's process still runs after WINDOW_SETTLE_MS, not
 * open, with what it said, when it ended before (no webview on the system, its library not fetched). On Linux, when the
 * published library cannot run there, Naima's own builds for older systems are tried next, then a browser's app mode.
 * Only on Deno, which runs window-main.ts; elsewhere not open.
 */
export async function openWindow(url: string, title: string, settleMs: number = WINDOW_SETTLE_MS): Promise<Opened> {
  if (!("Deno" in globalThis)) return { opened: false, reason: "a window is opened with Deno" }
  const first = await tryWindow(url, title, settleMs)
  if (first.opened || process.platform !== "linux") return first
  const arch = (globalThis as unknown as { Deno: { build: { arch: string } } }).Deno.build.arch
  for (const lib of linuxWebviews(fileURLToPath(new URL("./webview/linux/", import.meta.url)), arch)) {
    if ((await tryWindow(url, title, settleMs, { PLUGIN_URL: lib })).opened) return { opened: true }
  }
  const app = onPath(APP_BROWSERS, process.env["PATH"] ?? "")
  if (app && (await openAppWindow(app, url)).opened) return { opened: true }
  return first
}

/** Open `url` where the person reads it: a window of the system's webview, else the default browser, saying why. */
export async function openWhereRead(url: string, title: string, os: string, say: (line: string) => void = () => {}): Promise<Opened> {
  const window = await openWindow(url, title)
  if (window.opened) return window
  say(`naima ui: no window could be opened (${window.reason}); opening the browser instead`)
  return openBrowser(browserCommand(os, url))
}
