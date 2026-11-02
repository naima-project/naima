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
//                         reads these; with ?at=<commit>, as that commit had it
//                         (at.ts), read only
//   /data/tabs            the tabs plugins contribute to the new UI (tabs.ts), each
//                         with its subtabs; every `ui-views` view is one too
//   /data/tab/<name>?sub= what a tab shows for a subtab, at the moment ?at=:
//                         a component's data, or the address of a page
//   /page/<key>/…         the tabs' pages and frames, sandboxed (tabs.ts): the
//                         key, derived from the token, is all they need and all
//                         they open
//   /data/metro           what the new UI's rail draws: the trunk, the lines,
//                         the branches, the workers and the goals ahead (metro.ts)
//   /events               a stream of server-sent events, one when the project
//                         changes: a commit, a branch moved, the tracker's files
//                         (live.ts)
//   /session              this run's CSRF value and the actions the UI may run
//   POST /action/<name>   run one naima command of a short list through the CLI,
//                         as JSON in and out (actions.ts); the only write
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
import { actionArgv, type ActionResult, type ActionRunner, ACTIONS, cliRunner } from "./actions.ts"
import { AtCache, AtRefused, commitOf } from "./at.ts"
import { EventHub, watchProject } from "./live.ts"
import { metroData } from "./metro.ts"
import {
  allTabs,
  contentProblem,
  fileUrl,
  folderFile,
  framedViewHtml,
  framePage,
  PAGE_TYPES,
  pageKey,
  pagePolicy,
  tabList,
  type UiTab,
  type UiTabContent,
  viewOf,
} from "./tabs.ts"

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
  opts: {
    token?: string
    port?: number
    log?: (line: string) => void
    bundle?: string | null
    /** How often the project is looked at for /events, and how long a change settles, in ms. */
    watch?: { interval?: number; debounce?: number }
    /** What runs an action's command: the CLI by default. */
    actions?: ActionRunner
    /** The tabs plugins contribute to `ui-tabs`; every view is shown as a tab too. */
    tabs?: readonly UiTab[]
  } = {},
): Promise<Served> {
  const token = opts.token ?? randomBytes(24).toString("hex")
  const csrf = randomBytes(24).toString("hex")
  const key = pageKey(token)
  const tabs = allTabs(opts.tabs ?? [], views)
  const runAction = opts.actions ?? cliRunner()
  const atCache = new AtCache()
  const hub = new EventHub((send) => watchProject(ctx, send, opts.watch ?? {}))
  let origin = ""
  const bundle = opts.bundle === undefined ? BUNDLE : opts.bundle
  const app = bundle !== null && existsSync(join(bundle, "index.html")) ? bundle : null
  /** POST /action/<name>: refused unless the cookie, this run's CSRF value, this server's Origin and a same-origin fetch say it is this UI's page. */
  const action = async (req: IncomingMessage, res: ServerResponse, url: URL, headers: Record<string, string>): Promise<void> => {
    const cookie = cookieToken(req)
    const site = req.headers["sec-fetch-site"]
    const refuse = (why: string) => send(res, 403, "application/json", JSON.stringify({ error: `naima ui: ${why}` }), headers)
    if (!cookie || !same(cookie, token)) return refuse("an action needs the token's cookie")
    if (!same(String(req.headers["x-naima-csrf"] ?? ""), csrf)) return refuse("an action needs this run's CSRF value, from /session")
    if (req.headers.origin !== origin) return refuse("an action comes from this server's own page only")
    if (site !== undefined && site !== "same-origin") return refuse("an action comes from this server's own page only")
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return refuse("an action's body is JSON")
    let raw = ""
    for await (const chunk of req) {
      raw += String(chunk)
      if (raw.length > 64_000) return send(res, 413, "application/json", JSON.stringify({ error: "naima ui: the body is too large" }), headers)
    }
    let body: unknown
    try {
      body = raw.trim() ? JSON.parse(raw) : {}
    } catch {
      return send(res, 400, "application/json", JSON.stringify({ error: "naima ui: the body is not JSON" }), headers)
    }
    const argv = actionArgv(decodeURIComponent(url.pathname.slice("/action/".length)), body)
    if (typeof argv === "string") return send(res, 400, "application/json", JSON.stringify({ error: `naima ui: ${argv}` }), headers)
    const r = await runAction(argv, ctx.root)
    const result: ActionResult = { command: ["naima", ...argv], code: r.code, out: r.out, err: r.err }
    return send(res, 200, "application/json", JSON.stringify(result), headers)
  }
  /** The context of the moment ?at= names (the live one when absent), or why it cannot be read. */
  const momentOf = (url: URL): Context | { status: number; error: string } => {
    const at = url.searchParams.get("at")
    if (at === null) {
      ctx.reload()
      return ctx
    }
    try {
      return atCache.get(ctx, commitOf(ctx, at))
    } catch (e) {
      return { status: e instanceof AtRefused ? 400 : 500, error: e instanceof Error ? e.message : String(e) }
    }
  }
  /** A tab's content for /data/tab/<name>?sub=&at= and its page: the tab, the subtab, and what render gave, checked. */
  const tabContent = async (url: URL, prefix = "/data/tab/"): Promise<
    { tab: UiTab; sub: string | null; at: string | null; content: UiTabContent } | { status: number; error: string }
  > => {
    let name: string
    try {
      name = decodeURIComponent(url.pathname.slice(prefix.length))
    } catch {
      return { status: 400, error: "naima ui: a path that is not one" }
    }
    const tab = tabs.find((t) => t.name === name)
    if (!tab) return { status: 404, error: `naima ui: no tab ${name}` }
    const asked = url.searchParams.get("sub")
    const subs = tab.subtabs ?? []
    const sub = asked ?? subs[0]?.name ?? null
    if (sub !== null && !subs.some((s) => s.name === sub)) return { status: 404, error: `naima ui: the tab ${name} has no subtab ${sub}` }
    const from = momentOf(url)
    if ("error" in from) return from
    const query: Record<string, string[]> = {}
    for (const [k, v] of url.searchParams) if (!["token", "at", "sub"].includes(k)) (query[k] ??= []).push(v)
    try {
      const content = await tab.render({ sub, query }, from)
      const problem = contentProblem(content)
      if (problem) return { status: 500, error: `naima ui: the ${name} tab's content ${problem}` }
      return { tab, sub, at: url.searchParams.get("at"), content }
    } catch (e) {
      return { status: 500, error: `naima ui: the ${name} tab failed: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  /** What /data/tab answers: a component's data with every frame's path made the address it is served at, or a page's address. */
  const shown = (tab: UiTab, sub: string | null, at: string | null, c: UiTabContent): Record<string, unknown> => {
    const head = { tab: tab.name, sub }
    if ("page" in c) return { ...head, page: fileUrl(key, tab.name, c.page) }
    if ("html" in c) {
      const view = viewOf(tab)
      const q = new URLSearchParams()
      if (sub !== null) q.set("sub", sub)
      if (at !== null) q.set("at", at)
      const qs = q.size ? `?${q}` : ""
      return { ...head, page: view ? `/page/${key}/view/${encodeURIComponent(view.name)}${qs}` : `/page/${key}/tab/${encodeURIComponent(tab.name)}${qs}` }
    }
    if (c.component === "gallery") {
      const sections = c.data.sections.map((s) => ({ ...s, frames: s.frames.map((f) => ({ ...f, src: fileUrl(key, tab.name, f.src) })) }))
      return { ...head, component: c.component, data: { ...c.data, sections }, ...(c.lead === undefined ? {} : { lead: c.lead }) }
    }
    if (c.component === "list") {
      const items = c.data.items.map((i) => (i.src === undefined ? i : { ...i, src: fileUrl(key, tab.name, i.src) }))
      return { ...head, component: c.component, data: { ...c.data, items }, ...(c.lead === undefined ? {} : { lead: c.lead }) }
    }
    return { ...head, ...c }
  }
  /**
   * /page/<key>/…: the pages and frames of the tabs, refused without this run's page key; nothing else is reached with
   * it. files/<tab>/<path> a file of the tab's folder; tab/<tab>?sub= a page the tab makes; view/<name>?… a view's
   * page. Each goes out with the sandboxing policy, and sets no cookie.
   */
  const pages = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> => {
    const policy = { "content-security-policy": pagePolicy(origin) }
    const [, , given, kind, ...rest] = url.pathname.split("/")
    if (!given || !same(given, key)) return send(res, 403, "text/plain", "naima ui: this page needs the key of this run\n")
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "text/plain", "naima ui: read only\n")
    let parts: string[]
    try {
      parts = rest.map((p) => decodeURIComponent(p))
    } catch {
      return send(res, 400, "text/plain", "naima ui: a path that is not one\n")
    }
    if (kind === "files") {
      const [name, ...path] = parts
      const tab = tabs.find((t) => t.name === name)
      let dir: string | null = null
      try {
        dir = tab?.files ? tab.files(ctx) : null
      } catch (e) {
        return send(res, 500, "text/plain", `naima ui: the ${name} tab's folder failed: ${e instanceof Error ? e.message : String(e)}\n`)
      }
      const file = dir ? folderFile(dir, path.join("/")) : null
      if (!file) return send(res, 404, "text/plain", `naima ui: no ${url.pathname.split("/").slice(3).join("/")}\n`)
      res.writeHead(200, {
        "content-type": PAGE_TYPES[extname(file).toLowerCase()]!,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        ...policy,
      })
      return void res.end(req.method === "HEAD" ? undefined : readFileSync(file))
    }
    if (kind === "tab") {
      const got = await tabContent(url, `/page/${given}/tab/`)
      if ("error" in got) return send(res, got.status, "text/plain", `${got.error}\n`, policy)
      if (!("html" in got.content)) return send(res, 404, "text/plain", `naima ui: the ${got.tab.name} tab shows no page of its own here\n`, policy)
      return send(res, 200, "text/html", framePage(got.tab.title, got.content.html, got.content.css), policy)
    }
    if (kind === "view") {
      const view = views.find((v) => v.name === parts[0])
      if (!view || parts.length !== 1) return send(res, 404, "text/plain", `naima ui: no view ${parts.join("/")}\n`, policy)
      const from = momentOf(url)
      if ("error" in from) return send(res, from.status, "text/plain", `${from.error}\n`, policy)
      try {
        const params = paramsOf(url)
        delete params["at"]
        const r = await view.render(params, from)
        return send(res, 200, "text/html", framePage(view.title, framedViewHtml(key, r.html), r.css), policy)
      } catch (e) {
        return send(res, 500, "text/plain", `naima ui: the ${view.name} view failed: ${e instanceof Error ? e.message : String(e)}\n`, policy)
      }
    }
    return send(res, 404, "text/plain", `naima ui: no ${url.pathname.split("/").slice(3).join("/")}\n`)
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${HOST}`)
    if (opts.log) res.once("finish", () => opts.log?.(`${res.statusCode} ${req.method} ${url.pathname} ${req.headers["user-agent"] ?? ""}`))
    if (url.pathname.startsWith("/page/")) return pages(req, res, url)
    const given = url.searchParams.get("token") ?? cookieToken(req)
    if (!given || !same(given, token)) return send(res, 403, "text/plain", "naima ui: this address needs the token it was opened with\n")
    const headers = { "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict` }
    if (req.method === "POST" && url.pathname.startsWith("/action/")) return action(req, res, url, headers)
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "text/plain", "naima ui: read only\n", headers)
    if (url.pathname === "/session") return send(res, 200, "application/json", JSON.stringify({ csrf, actions: ACTIONS }), headers)
    if (url.pathname === "/events") return hub.add(res, headers)
    if (url.pathname === "/data/tabs") return send(res, 200, "application/json", JSON.stringify(tabList(tabs), null, 2), headers)
    if (url.pathname.startsWith("/data/tab/")) {
      const got = await tabContent(url)
      if ("error" in got) return send(res, got.status, "text/plain", `${got.error}\n`, headers)
      return send(res, 200, "application/json", JSON.stringify(shown(got.tab, got.sub, got.at, got.content), null, 2), headers)
    }
    if (url.pathname === "/data/metro") {
      try {
        ctx.reload()
        return send(res, 200, "application/json", JSON.stringify(await metroData(ctx), null, 2), headers)
      } catch (e) {
        return send(res, 500, "text/plain", `naima ui: the metro data failed: ${e instanceof Error ? e.message : String(e)}\n`, headers)
      }
    }
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
    const at = url.searchParams.get("at")
    if (at !== null && kind !== "data") return send(res, 400, "text/plain", "naima ui: ?at= is for /data/<view> only\n", headers)
    let from = ctx
    if (at !== null) {
      try {
        from = atCache.get(ctx, commitOf(ctx, at))
      } catch (e) {
        return send(res, e instanceof AtRefused ? 400 : 500, "text/plain", `${e instanceof Error ? e.message : String(e)}\n`, headers)
      }
    }
    try {
      if (at === null) ctx.reload()
      const params = paramsOf(url)
      delete params["at"]
      const r = await view.render(params, from)
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
      origin = `http://${HOST}:${port}`
      resolve({
        url: `http://${HOST}:${port}/?token=${token}`,
        host: HOST,
        port,
        token,
        close: () =>
          new Promise<void>((done) => {
            hub.close()
            atCache.clear()
            server.closeAllConnections?.()
            server.close(() => done())
          }),
      })
    })
  })
}
