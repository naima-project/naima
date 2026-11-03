// Where `naima ui` shows its server: the default browser. The desktop app is the Tauri shell around the same bundle,
// with Naima as its sidecar, not this command.

import { spawn } from "node:child_process"

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
