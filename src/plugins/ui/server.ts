// The server `naima ui` runs: plain node:http, so it runs the same on Deno,
// Node and Bun, bound to the loopback interface on a free port. Every request
// carries the run's token — in the URL the window opens, then in a cookie the
// first answer sets — or is refused: another user of the machine, or a page
// in a browser, cannot read the project through it.
//
//   /                     the new UI: the built bundle the product ships in
//                         ui/dist (its index.html, then its files by path);
//                         /classic when there is no bundle
//   /classic              the provisional first screen: every panel, one
//                         under the other; the first tab when no view is a panel
//   /view/<name>?…        a view's page: the tabs, then the view
//   /data/<name>?…        a view's data, as JSON — a panel's too; the new UI
//                         reads these
//
// Each request renders the view again from the files: the page is live.

import { Buffer } from "node:buffer"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { extname, join, normalize, sep } from "node:path"
import { fileURLToPath } from "node:url"
import type { Context } from "../../core/api.ts"

/** A view of `naima ui`: what any plugin contributes to the `ui-views` point. */
export interface UiView {
  /** The path it is served at: /view/<name>. */
  name: string
  /** Its tab. */
  title: string
  says: string
  /** Where its tab, or its panel, stands: lower first, 0 when absent; equal ones in load order. */
  order?: number
  /** Shown on the first screen, beside the other panels, rather than as a tab of its own. */
  panel?: boolean
  /** The view for these query parameters, rendered from the files at each request: its data, its HTML, and the styles that HTML needs. */
  render(params: Record<string, string[]>, ctx: Context): UiRender | Promise<UiRender>
}

export interface UiRender {
  data: unknown
  /** The view's body, inside the page the server makes. */
  html: string
  css?: string
}

export interface Served {
  /** The URL that opens the first view, with the token. */
  url: string
  host: string
  port: number
  token: string
  close(): Promise<void>
}

export const HOST = "127.0.0.1"
const COOKIE = "naima-ui"

/** The new UI's bundle, as the product ships it: ui/dist, built in the workshop and committed. */
export const BUNDLE: string = fileURLToPath(new URL("../../../ui/dist/", import.meta.url))

/** The provisional first screen's path, now that / is the new UI. */
const CLASSIC = "/classic"

/** The media types of the bundle's files; anything else is not served. */
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
}

/** The bundle's pages may load only what the bundle and this server hold. */
const POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

/** The file of the bundle a path names — / is index.html — or null when it names none, or names one outside the bundle. */
function bundleFile(dir: string, path: string): string | null {
  const rel = path === "/" ? "index.html" : path.slice(1)
  if (!rel || rel.includes("\u0000")) return null
  const file = normalize(join(dir, rel))
  const root = normalize(dir.endsWith(sep) ? dir : dir + sep)
  if (!file.startsWith(root) || !TYPES[extname(file)]) return null
  return existsSync(file) && statSync(file).isFile() ? file : null
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const cookieToken = (req: IncomingMessage): string | undefined =>
  (req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")).find(([k]) => k === COOKIE)?.[1]

/** The first screen's tab. */
const HOME = { title: "Home", says: "where the project stands: the panels the plugins contribute" }

/** The page around a body: the tabs — the first screen's when there are panels, then every view that is not one — then the body. */
function page(views: readonly UiView[], current: UiView | null, title: string, body: string, css = ""): string {
  const link = (href: string, here: boolean, says: string, name: string) =>
    `<a href="${href}"${here ? ' aria-current="page"' : ""} title="${esc(says)}">${esc(name)}</a>`
  const tabs = [
    ...(views.some((v) => v.panel) ? [link(CLASSIC, current === null || current.panel === true, HOME.says, HOME.title)] : []),
    ...views.filter((v) => !v.panel).map((v) => link(`/view/${encodeURIComponent(v.name)}`, v === current, v.says, v.title)),
  ]
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>Naima — ${esc(title)}</title>`,
    "<style>",
    "body{font-family:system-ui,sans-serif;margin:16px;line-height:1.4}",
    "nav{display:flex;gap:12px;margin-bottom:12px}nav a{color:inherit}nav a[aria-current]{font-weight:700;text-decoration:none}",
    "form.pick{margin:8px 0 16px}fieldset{border:1px solid #8888;margin:0 0 8px}label{margin-right:10px;white-space:nowrap}",
    "section.panel{margin:0 0 24px}",
    css,
    "</style></head><body>",
    `<nav aria-label="Views">${tabs.join("")}</nav>`,
    "<main>",
    body,
    "</main>",
    "</body></html>",
  ].join("\n")
}

/** The first screen: every panel, each rendered now, in a section headed by its title; one that fails says so in its place. */
async function home(views: readonly UiView[], ctx: Context): Promise<string> {
  const panels = views.filter((v) => v.panel)
  const parts = await Promise.all(panels.map(async (v) => {
    const id = `panel-${v.name}`
    const head = `<h2 id="${id}"><a href="/view/${encodeURIComponent(v.name)}">${esc(v.title)}</a></h2>`
    try {
      const r = await v.render({}, ctx)
      return { html: `<section class="panel" aria-labelledby="${id}">${head}\n${r.html}</section>`, css: r.css ?? "" }
    } catch (e) {
      return {
        html: `<section class="panel" aria-labelledby="${id}">${head}<p role="alert">This panel failed: ${
          esc(e instanceof Error ? e.message : String(e))
        }</p></section>`,
        css: "",
      }
    }
  }))
  return page(views, null, HOME.title, ["<h1>Naima</h1>", ...parts.map((p) => p.html)].join("\n"), [...new Set(parts.map((p) => p.css))].join("\n"))
}

function paramsOf(url: URL): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [k, v] of url.searchParams) if (k !== "token") (out[k] ??= []).push(v)
  return out
}

function send(res: ServerResponse, status: number, type: string, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    "content-type": `${type}; charset=utf-8`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...headers,
  })
  res.end(body)
}

/**
 * Serve the views on the loopback interface, on a free port unless `port` is given, refusing every request without
 * `token` (a fresh random one by default), and the new UI's bundle at / from `bundle` (the product's by default;
 * null for none). `log` hears one line per request: its status, method, path and user agent.
 */
export function serve(
  ctx: Context,
  views: readonly UiView[],
  opts: { token?: string; port?: number; log?: (line: string) => void; bundle?: string | null } = {},
): Promise<Served> {
  const token = opts.token ?? randomBytes(24).toString("hex")
  const bundle = opts.bundle === undefined ? BUNDLE : opts.bundle
  const app = bundle !== null && existsSync(join(bundle, "index.html")) ? bundle : null
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${HOST}`)
    if (opts.log) res.once("finish", () => opts.log?.(`${res.statusCode} ${req.method} ${url.pathname} ${req.headers["user-agent"] ?? ""}`))
    const given = url.searchParams.get("token") ?? cookieToken(req)
    if (!given || !same(given, token)) return send(res, 403, "text/plain", "naima ui: this address needs the token it was opened with\n")
    const headers = { "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict` }
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "text/plain", "naima ui: read only\n", headers)
    let parts: string[]
    try {
      parts = url.pathname.split("/").map((p) => decodeURIComponent(p))
    } catch {
      return send(res, 400, "text/plain", "naima ui: a path that is not one\n", headers)
    }
    const [, kind, name] = parts
    if (app && kind !== "view" && kind !== "data" && url.pathname !== CLASSIC) {
      const file = bundleFile(app, parts.join("/"))
      if (!file) return send(res, 404, "text/plain", `naima ui: no ${url.pathname}\n`, headers)
      res.writeHead(200, {
        "content-type": TYPES[extname(file)]!,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy": POLICY,
        ...headers,
      })
      return res.end(req.method === "HEAD" ? undefined : readFileSync(file))
    }
    if (url.pathname === "/") return send(res, 302, "text/plain", "", { ...headers, location: CLASSIC })
    if (url.pathname === CLASSIC && views.some((v) => v.panel)) {
      try {
        ctx.reload()
        return send(res, 200, "text/html", await home(views, ctx), headers)
      } catch (e) {
        return send(res, 500, "text/plain", `naima ui: the first screen failed: ${e instanceof Error ? e.message : String(e)}\n`, headers)
      }
    }
    if (url.pathname === CLASSIC) {
      const first = views[0]
      if (!first) return send(res, 200, "text/html", "<!doctype html><title>Naima</title><p>No plugin contributes a view.</p>", headers)
      return send(res, 302, "text/plain", "", { ...headers, location: `/view/${encodeURIComponent(first.name)}` })
    }
    const view = views.find((v) => v.name === name)
    if (!view || (kind !== "view" && kind !== "data")) return send(res, 404, "text/plain", `naima ui: no ${url.pathname}\n`, headers)
    try {
      ctx.reload()
      const r = await view.render(paramsOf(url), ctx)
      if (kind === "data") return send(res, 200, "application/json", JSON.stringify(r.data, null, 2), headers)
      return send(res, 200, "text/html", page(views, view, view.title, r.html, r.css), headers)
    } catch (e) {
      return send(res, 500, "text/plain", `naima ui: the ${view.name} view failed: ${e instanceof Error ? e.message : String(e)}\n`, headers)
    }
  })
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(opts.port ?? 0, HOST, () => {
      const port = (server.address() as AddressInfo).port
      resolve({
        url: `http://${HOST}:${port}/?token=${token}`,
        host: HOST,
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
