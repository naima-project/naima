// Naima as the desktop app's sidecar: `naima ui --sidecar`, which the Tauri shell starts in the project's folder and
// talks to over its standard input and output, one JSON object a line, with no network listener. It answers the same
// bridge commands the browser reaches over HTTP (bridge.ts), and one more the shell itself needs, `file`, which reads a
// file of a tab's folder for the shell's naima-files: scheme, the desktop's way of framing a tab's pages.
//
//   in   {"id": 1, "command": "data", "args": {"view": "gates"}}
//   out  {"id": 1, "ok": <answer>}  or  {"id": 1, "error": "..."}
//   out  {"feed": "changes", "event": {...}}          each change of the project, pushed as it comes
//
// It stops when its standard input ends, as it does when the shell quits.

import { readFileSync } from "node:fs"
import { extname } from "node:path"
import { createInterface } from "node:readline"
import type { Readable } from "node:stream"
import type { Context } from "../../core/api.ts"
import { naimaBridge } from "./bridge.ts"
import type { Handlers, Json } from "./bridge-handler.ts"
import { fileIn } from "./serve.ts"
import { PAGE_TYPES, type UiTab, type UiView } from "./tabs.ts"

/** Where the desktop's webview loads a file of a tab's folder: the shell's naima-files: scheme, which WebView2 names as a host. */
export function desktopFileUrl(os: string, tab: string, rel: string): string {
  const path = `${encodeURIComponent(tab)}/${rel.split(/[\\/]/).filter((s) => s && s !== ".").map(encodeURIComponent).join("/")}`
  return os === "windows" ? `http://naima-files.localhost/${path}` : `naima-files://localhost/${path}`
}

export interface SidecarOptions {
  views: readonly UiView[]
  tabs: readonly UiTab[]
  /** The folder of a tab's files now, by the tab's name. */
  tabFolder(tab: string): string | null
  os: string
  input: Readable
  write(line: string): void
  watch?: { interval?: number; debounce?: number }
}

/** Answers the shell until its input ends; returns the exit code. */
export async function runSidecar(ctx: Context, opts: SidecarOptions): Promise<number> {
  const bridge = naimaBridge(ctx, {
    views: opts.views,
    tabs: opts.tabs,
    fileUrl: (tab, rel) => desktopFileUrl(opts.os, tab, rel),
    ...(opts.watch ? { watch: opts.watch } : {}),
  })
  const handlers: Handlers = {
    ...bridge.handlers,
    file: ({ tab, path }) => {
      const dir = opts.tabFolder(String(tab))
      const found = dir ? fileIn(dir, String(path ?? ""), PAGE_TYPES) : null
      if (!found) throw new Error(`no file ${String(path)} in the ${String(tab)} tab`)
      return { type: PAGE_TYPES[extname(found).toLowerCase()]!, base64: readFileSync(found).toString("base64") }
    },
  }
  const send = (message: { [key: string]: Json }) => opts.write(JSON.stringify(message))
  const stop = bridge.feeds["changes"]!((event) => send({ feed: "changes", event }))
  const pending = new Set<Promise<void>>()
  try {
    for await (const line of createInterface({ input: opts.input, crlfDelay: Infinity })) {
      if (!line.trim()) continue
      let request: { id?: unknown; command?: unknown; args?: unknown }
      try {
        request = JSON.parse(line)
      } catch {
        send({ error: "a line that is not JSON" })
        continue
      }
      const id = typeof request.id === "number" ? request.id : null
      const command = String(request.command)
      const args = request.args && typeof request.args === "object" && !Array.isArray(request.args) ? request.args as { [key: string]: Json } : {}
      const handler = Object.hasOwn(handlers, command) ? handlers[command] : undefined
      const answer = (async () => {
        try {
          if (!handler) throw new Error(`no such command: ${command}`)
          send({ id, ok: await handler(args) })
        } catch (e) {
          send({ id, error: e instanceof Error ? e.message : String(e) })
        }
      })()
      pending.add(answer)
      void answer.finally(() => pending.delete(answer))
    }
    await Promise.all(pending)
    return 0
  } finally {
    stop()
    bridge.close()
  }
}
