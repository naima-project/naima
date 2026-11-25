// The desktop app's sidecar attached to a UI server that already runs on the project (one-server.ts): it answers the
// shell's commands by asking that server over HTTP, the bridge's own POST /bridge/<command>, and pushes the server's
// feeds to the shell as they come (server-sent events), so the project has one server and the window is a client of it.
// `bundle` and `file`, which name the folder the shell reads and read a tab's files for it, stay the sidecar's own.

import type { Json } from "./bridge-handler.ts"

export interface Remote {
  /** Runs a bridge command on the server: its answer, or an error with the server's words. */
  call(command: string, args: { [key: string]: Json }): Promise<Json>
  /** Listens to a feed of the server; the function it returns stops it. */
  feed(name: string, emit: (event: Json) => void): () => void
}

/** The server at `url`, the address with its token that a browser opens (`http://host:port/?token=...`). */
export function remoteServer(url: string, fetcher: typeof fetch = fetch): Remote {
  const at = new URL(url)
  const origin = at.origin
  const token = at.searchParams.get("token") ?? ""
  const address = (name: string) => `${origin}/bridge/${encodeURIComponent(name)}?token=${encodeURIComponent(token)}`
  return {
    async call(command, args) {
      const r = await fetcher(address(command), { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(args) })
      const body = await r.json().catch(() => null) as { ok?: Json; error?: string } | null
      if (!r.ok || !body || "error" in body) throw new Error(body?.error ?? `${command}: the server answered ${r.status}`)
      return body.ok ?? null
    },
    feed(name, emit) {
      const stop = new AbortController()
      void (async () => {
        try {
          const r = await fetcher(address(name), { signal: stop.signal })
          if (!r.ok || !r.body) return
          const reader = r.body.getReader()
          const decoder = new TextDecoder()
          let kept = ""
          for (;;) {
            const { value, done } = await reader.read()
            if (done) return
            kept += decoder.decode(value, { stream: true })
            let end: number
            while ((end = kept.indexOf("\n\n")) >= 0) {
              const block = kept.slice(0, end)
              kept = kept.slice(end + 2)
              const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n")
              if (data) {
                try {
                  emit(JSON.parse(data) as Json)
                } catch {
                  // not an event of ours
                }
              }
            }
          }
        } catch {
          // the server went, or this was stopped
        }
      })()
      return () => stop.abort()
    },
  }
}
