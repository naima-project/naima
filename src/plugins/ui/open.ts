// Where `naima ui` shows its server: a window of the system's webview opened from this Naima (window-main.ts), and the
// default browser when no window can be opened. The desktop app is the Tauri shell around the same bundle, with Naima as
// its sidecar, not this command.

import { spawn } from "node:child_process"
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
export const WINDOW_MAIN: string = fileURLToPath(new URL("./window-main.ts", import.meta.url))

/** How long a window has to fail before it counts as open, in ms: a webview that cannot start ends within it. */
export const WINDOW_SETTLE_MS = 4_000

/** The command that opens `url` in a window titled `title`: Deno running window-main.ts with what the webview needs. */
export function windowCommand(deno: string, url: string, title: string): [string, ...string[]] {
  return [deno, "run", "--allow-ffi", "--allow-net", "--allow-read", "--allow-write", "--allow-env", WINDOW_MAIN, url, title]
}

/**
 * Open `url` in a window of the system's webview: open when the window's process still runs after WINDOW_SETTLE_MS, not
 * open, with what it said, when it ended before (no webview on the system, its library not fetched). Only on Deno, which
 * runs window-main.ts; elsewhere not open.
 */
export function openWindow(url: string, title: string, settleMs: number = WINDOW_SETTLE_MS): Promise<Opened> {
  if (!("Deno" in globalThis)) return Promise.resolve({ opened: false, reason: "a window is opened with Deno" })
  const [program, ...args] = windowCommand(process.execPath, url, title)
  return new Promise((resolve) => {
    const child = spawn(program, args, { stdio: ["ignore", "ignore", "pipe"], detached: true })
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

/** Open `url` where the person reads it: a window of the system's webview, else the default browser, saying why. */
export async function openWhereRead(url: string, title: string, os: string, say: (line: string) => void = () => {}): Promise<Opened> {
  const window = await openWindow(url, title)
  if (window.opened) return window
  say(`naima ui: no window could be opened (${window.reason}); opening the browser instead`)
  return openBrowser(browserCommand(os, url))
}
