// What `naima ui` serves in a browser: the new UI's bundle and Naima's bridge (bridge.ts) under /bridge/, answered by
// the UI stance's request handler (bridge-handler.ts), on the loopback interface, on a free port. Every request carries
// this run's token, in the URL the browser opens and then in the cookie the first answer sets, or is refused: another
// user of the machine, or a page of another site, cannot read the project through it. A forwarded port reaches it
// the same way, with the same token.
//
//   POST /bridge/<command>     a bridge command, its arguments and answer as JSON; refused from another origin
//   GET  /bridge/<feed>        a bridge feed, as server-sent events
//   GET  /files/<key>/<tab>/…  a file of a tab's folder, for a page or a frame of the app, sandboxed: the key,
//                              derived from the token, is all it needs, and all it opens
//   GET  anything else         a file of the bundle, index.html for /
//
// It listens with node:http, which Deno, Node and Bun all have, and hands each request to the stance's handler as a
// web Request; the answer, a feed's stream included, goes back as it comes.

import { Buffer } from "node:buffer"
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { extname, join, normalize, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { bridgeHandler, type Feeds, type Handlers } from "./bridge-handler.ts"
import { PAGE_TYPES, pagePolicy } from "./tabs.ts"

export const HOST = "127.0.0.1"
const COOKIE = "naima-ui"

/** The new UI's bundle, as the product ships it: ui/dist, built in the workshop and committed. */
export const BUNDLE: string = fileURLToPath(new URL("../../../ui/dist/", import.meta.url))

/** The bundle's pages may load only what the bundle and this server hold, and frame only this server's files. */
const POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

const SAFE = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" }

/** The key of a run's tab files: derived from its token, so it opens those files and nothing else, and changes with each run. */
export const filesKey = (token: string): string => createHmac("sha256", token).update("naima ui files").digest("hex").slice(0, 32)

/** Where a file of a tab's folder is served, its segments encoded. */
export const filesUrl = (key: string, tab: string, rel: string): string =>
  `/files/${key}/${encodeURIComponent(tab)}/${rel.split(/[\\/]/).filter((s) => s && s !== ".").map(encodeURIComponent).join("/")}`

/** The file of the folder `dir` the relative path `rel` names, with one of `types`; null when it names none, or one outside it. */
export function fileIn(dir: string, rel: string, types: Record<string, string>): string | null {
  if (!rel || rel.includes("\u0000")) return null
  const root = normalize(dir.endsWith(sep) ? dir : dir + sep)
  let file = normalize(join(dir, rel))
  if (!file.startsWith(root)) return null
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html")
  if (!types[extname(file).toLowerCase()]) return null
  return existsSync(file) && statSync(file).isFile() ? file : null
}

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const cookieToken = (req: IncomingMessage): string | undefined =>
  (req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")).find(([k]) => k === COOKIE)?.[1]

function plain(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...SAFE, ...headers })
  res.end(`naima ui: ${body}\n`)
}

function file(req: IncomingMessage, res: ServerResponse, path: string, type: string, headers: Record<string, string>): void {
  res.writeHead(200, { "content-type": type, ...SAFE, ...headers })
  res.end(req.method === "HEAD" ? undefined : readFileSync(path))
}

/** A request as the web's Request, its body read whole as text (64 KB at most: a command's JSON), for the stance's handler. */
async function webRequest(req: IncomingMessage, origin: string): Promise<Request | null> {
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v)
  let body: string | undefined
  if (req.method === "POST") {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > 64_000) return null
      chunks.push(chunk as Buffer)
    }
    body = Buffer.concat(chunks).toString("utf8")
  }
  return new Request(new URL(req.url ?? "/", origin), { method: req.method ?? "GET", headers, ...(body ? { body } : {}) })
}

/** Writes a web Response back, streaming its body until it ends or the client goes. */
async function send(res: ServerResponse, answer: Response, headers: Record<string, string>): Promise<void> {
  res.writeHead(answer.status, { ...Object.fromEntries(answer.headers), ...SAFE, ...headers })
  if (!answer.body) return void res.end()
  const reader = answer.body.getReader()
  res.once("close", () => void reader.cancel().catch(() => {}))
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      res.write(value)
    }
  } catch {
    // the client went: the reader was cancelled
  }
  res.end()
}

export interface Served {
  /** The address that opens the UI, with the token. */
  url: string
  port: number
  token: string
  close(): Promise<void>
}

export interface ServeOptions {
  /** Naima's bridge commands and feeds (bridge.ts). */
  handlers: Handlers
  feeds: Feeds
  /** The folder of a tab's files, by the tab's name: null when it has none. */
  tabFolder(tab: string): string | null
  token?: string
  port?: number
  /** The bundle's folder, the product's by default. */
  bundle?: string
  /** One line per request: its status, method and path. */
  log?: (line: string) => void
}

/** A fresh token for a run: made before serving, since the bridge names its tab files by the key derived from it. */
export function newToken(): string {
  return randomBytes(24).toString("hex")
}

/** Serves the bundle and the bridge on the loopback interface until `close`. */
export function serve(opts: ServeOptions): Promise<Served> {
  const token = opts.token ?? newToken()
  const key = filesKey(token)
  const bundle = opts.bundle ?? BUNDLE
  let listening = ""
  const handle = bridgeHandler({ handlers: opts.handlers, feeds: opts.feeds })
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${HOST}`)
    // The origin the page was opened at: this address, or a forwarded port's, which the browser names in Host.
    const host = req.headers.host ?? ""
    const origin = /^[\w.-]+(:\d+)?$|^\[[\d:a-f]+\](:\d+)?$/i.test(host) ? `http://${host}` : listening
    if (opts.log) res.once("finish", () => opts.log?.(`${res.statusCode} ${req.method} ${url.pathname}`))
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") return plain(res, 405, "read and bridge commands only")
    const parts = url.pathname.split("/")
    // A tab's file, framed in a sandbox of its own, whose requests carry no cookie: the key is what opens it.
    if (parts[1] === "files") {
      if (!parts[2] || !same(parts[2], key)) return plain(res, 403, "this file needs the key of this run")
      if (req.method === "POST") return plain(res, 405, "read only")
      let tab: string
      let rel: string
      try {
        tab = decodeURIComponent(parts[3] ?? "")
        rel = parts.slice(4).map(decodeURIComponent).join("/")
      } catch {
        return plain(res, 400, "a path that is not one")
      }
      const dir = opts.tabFolder(tab)
      const found = dir ? fileIn(dir, rel, PAGE_TYPES) : null
      if (!found) return plain(res, 404, `no ${parts.slice(3).join("/")}`)
      return file(req, res, found, PAGE_TYPES[extname(found).toLowerCase()]!, { "content-security-policy": pagePolicy(origin) })
    }
    const given = url.searchParams.get("token") ?? cookieToken(req)
    if (!given || !same(given, token)) return plain(res, 403, "this address needs the token it was opened with")
    const cookie = { "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict` }
    if (parts[1] === "bridge") {
      // A command comes from this server's own page only: a page of another origin cannot run one, even with the cookie.
      if (req.method === "POST" && req.headers.origin !== undefined && req.headers.origin !== origin) {
        return plain(res, 403, "a bridge command comes from this server's own page only")
      }
      const request = await webRequest(req, origin)
      if (!request) return plain(res, 413, "the body is too large")
      return send(res, await handle(request), cookie)
    }
    if (req.method === "POST") return plain(res, 405, "read only", cookie)
    let rel: string
    try {
      rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1))
    } catch {
      return plain(res, 400, "a path that is not one", cookie)
    }
    const found = fileIn(bundle, rel, PAGE_TYPES)
    if (!found) return plain(res, 404, `no ${url.pathname}`, cookie)
    return file(req, res, found, PAGE_TYPES[extname(found).toLowerCase()]!, { ...cookie, "content-security-policy": POLICY })
  })
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(opts.port ?? 0, HOST, () => {
      const port = (server.address() as AddressInfo).port
      listening = `http://${HOST}:${port}`
      resolve({
        url: `${listening}/?token=${token}`,
        port,
        token,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.()
            server.close(() => done())
          }),
      })
    })
  })
}
