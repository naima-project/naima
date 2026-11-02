// The tabs of the new UI that plugins contribute, stances included: the `ui-tabs` point, the adapter that shows
// every `ui-views` view as a tab, and the pages a tab shows in a sandboxed frame.
//
// A tab has a name, a title, what it shows, an order and, optionally, subtabs. For a subtab, and for the moment
// the window shows, its `render` gives one of three things:
//
//   { component, data, lead? }   data the app draws with one of its own components: list, table, chart, gallery
//                                (of framed pages) or markdown. No code of the plugin runs in the app.
//   { page }                     a file of the tab's folder (`files`), shown as a sandboxed page.
//   { html, css? }               a page the plugin makes, shown sandboxed.
//
// A page, and every frame of a gallery, is served at /page/<key>/…, where the key is derived from the run's token:
// without it a request is refused, and with it nothing but pages is reached. Every page goes out with a
// Content-Security-Policy whose `sandbox` puts it in an opaque origin of its own, even opened on its own: its
// scripts cannot reach the app's page, its cookie, its data or its actions, and it may load nothing from outside
// this server and connect nowhere.

import { createHmac } from "node:crypto"
import { existsSync, statSync } from "node:fs"
import { extname, isAbsolute, join, normalize, sep } from "node:path"
import type { Context } from "../../core/api.ts"
import type { UiView } from "./server.ts"

/** The components the app draws a tab's data with: generic, built with the UI stance, the same for every plugin. */
export const COMPONENTS = ["list", "table", "chart", "gallery", "markdown"] as const
export type TabComponent = (typeof COMPONENTS)[number]

/** A subtab: its name (in `?sub=`), its title, and what it shows. */
export interface UiSubtab {
  name: string
  title: string
  says?: string
}

/** One framed page of a gallery: `src` is a path in the tab's folder (`files`), and `note` a line under it. */
export interface UiFrame {
  title: string
  src: string
  note?: string
  /** The one chosen among its section's frames. */
  chosen?: boolean
}

/** The data of each component. Text marked markdown is CommonMark, drawn without raw HTML. */
export interface ComponentData {
  /** Entries one under the other: a title, a line of text (markdown), a frame or page of the tab's folder to open. */
  list: { items: { title: string; text?: string; src?: string }[] }
  table: { columns: string[]; rows: (string | number | null)[][] }
  /** Lines over a shared x axis: each series its points, y a number. */
  chart: { series: { name: string; points: { x: string | number; y: number }[] }[]; unit?: string }
  /** Sections of framed pages side by side, each with a text (markdown) and, among its frames, the one chosen. */
  gallery: { sections: { title: string; text?: string; frames: UiFrame[] }[] }
  markdown: { text: string }
}

/** What a tab shows for a subtab, at a moment. */
export type UiTabContent =
  | { [K in TabComponent]: { component: K; data: ComponentData[K]; lead?: string } }[TabComponent]
  | { page: string }
  | { html: string; css?: string }

/** A tab of the new UI: what any plugin contributes to the `ui-tabs` point. */
export interface UiTab {
  /** Its name, in /data/tab/<name>: lowercase letters, digits and dashes. */
  name: string
  title: string
  says: string
  /** Where it stands among the tabs: lower first, 0 when absent; equal ones in load order. */
  order?: number
  /** Its subtabs, in order; the first is shown when the tab opens. None: the tab is one page. */
  subtabs?: readonly UiSubtab[]
  /** The folder whose files its pages and frames show, now; null when there is none. Read at each request. */
  files?(ctx: Context): string | null
  /** What it shows for `sub` (null when it has no subtabs), rendered from the files at each request; `ctx` is the moment's. */
  render(params: { sub: string | null; query: Record<string, string[]> }, ctx: Context): UiTabContent | Promise<UiTabContent>
}

const NAME = /^[a-z0-9][a-z0-9-]*$/
const blank = (s: unknown): boolean => typeof s !== "string" || !s.trim()

/** Why `v` is not a tab, or null. */
export function validateTab(v: unknown): string | null {
  const t = v as Partial<UiTab> | null
  if (!t || typeof t !== "object") return "is not an object"
  if (typeof t.name !== "string" || !NAME.test(t.name)) return "has no name of lowercase letters, digits and dashes"
  if (typeof t.title !== "string") return "has no title"
  if (t.order !== undefined && !Number.isFinite(t.order)) return "has an order that is not a number"
  if (t.subtabs !== undefined) {
    if (!Array.isArray(t.subtabs)) return "has subtabs that are not a list"
    const names = new Set<string>()
    for (const s of t.subtabs as unknown[]) {
      const u = s as Partial<UiSubtab> | null
      if (!u || typeof u.name !== "string" || !NAME.test(u.name) || typeof u.title !== "string") {
        return "has a subtab without a name of lowercase letters, digits and dashes, or without a title"
      }
      if (names.has(u.name)) return `has two subtabs named ${u.name}`
      names.add(u.name)
    }
  }
  if (t.files !== undefined && typeof t.files !== "function") return "has files that is not a function"
  return typeof t.render === "function" ? null : "has no render function"
}

/** Why a tab's content is not one, or null: checked at each request, so a plugin's mistake is said, not drawn. */
export function contentProblem(c: unknown): string | null {
  const x = c as Record<string, unknown> | null
  if (!x || typeof x !== "object") return "is not an object"
  if ("component" in x) {
    if (!COMPONENTS.includes(x["component"] as TabComponent)) return `names the component ${String(x["component"])}, not one of ${COMPONENTS.join(", ")}`
    if (!x["data"] || typeof x["data"] !== "object") return "has no data"
    if (x["lead"] !== undefined && typeof x["lead"] !== "string") return "has a lead that is not text"
    const d = x["data"] as Record<string, unknown>
    const list = (k: string) => Array.isArray(d[k])
    switch (x["component"] as TabComponent) {
      case "list":
        return list("items") ? null : "is a list without items"
      case "table":
        return list("columns") && list("rows") ? null : "is a table without columns and rows"
      case "chart":
        return list("series") ? null : "is a chart without series"
      case "gallery":
        return list("sections") && (d["sections"] as { frames?: unknown }[]).every((s) => Array.isArray(s?.frames))
          ? null
          : "is a gallery without sections of frames"
      case "markdown":
        return typeof d["text"] === "string" ? null : "is markdown without text"
    }
  }
  if ("page" in x) return typeof x["page"] === "string" ? null : "names a page that is not a path"
  if ("html" in x) return typeof x["html"] === "string" ? null : "has html that is not text"
  return "is none of { component, data }, { page } and { html }"
}

/** The tab a `ui-views` view is shown as: its page, sandboxed, the view's own links kept inside the frame. */
export function viewTab(v: UiView): UiTab {
  return {
    name: v.name,
    title: v.title,
    says: v.says,
    order: v.order ?? 0,
    view: v,
    render: async (params, ctx) => {
      const r = await v.render(params.query, ctx)
      return { html: r.html, ...(r.css === undefined ? {} : { css: r.css }) }
    },
  } as UiTab & { view: UiView }
}

/** The view a tab stands for, when it is one shown through the adapter. */
export const viewOf = (t: UiTab): UiView | null => (t as UiTab & { view?: UiView }).view ?? null

/**
 * The tabs the app shows: every contributed tab, then every view not shadowed by a tab of its name and not one the
 * app has a screen of its own for, by order.
 */
export function allTabs(tabs: readonly UiTab[], views: readonly UiView[]): UiTab[] {
  const named = new Set(tabs.map((t) => t.name))
  return [...tabs, ...views.filter((v) => !named.has(v.name) && !v.screen).map(viewTab)]
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.order ?? 0) - (b.t.order ?? 0) || a.i - b.i)
    .map(({ t }) => t)
}

/** The list the app reads at /data/tabs: each tab with its subtabs, and whether it stands for a `ui-views` view. */
export function tabList(tabs: readonly UiTab[]): { name: string; title: string; says: string; subtabs: UiSubtab[]; view: boolean }[] {
  return tabs.map((t) => ({
    name: t.name,
    title: t.title,
    says: t.says,
    subtabs: (t.subtabs ?? []).map((s) => ({ name: s.name, title: s.title, ...(s.says === undefined ? {} : { says: s.says }) })),
    view: viewOf(t) !== null,
  }))
}

/** The key of a run's pages: derived from its token, so it opens pages and nothing else, and changes with each run. */
export const pageKey = (token: string): string => createHmac("sha256", token).update("naima ui pages").digest("hex").slice(0, 32)

/** The media types of the files a page may load; anything else is not served. */
export const PAGE_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
}

/**
 * The policy of every page: a sandbox of its own (scripts and forms allowed, the same origin never), resources from this
 * server only, no connection anywhere, no base. No frame-ancestors: a page's own frames have an opaque ancestor, which
 * no source list matches; the page key in the path is what keeps other sites out.
 */
export function pagePolicy(origin: string): string {
  const self = `'self' ${origin}`
  return [
    "sandbox allow-scripts allow-forms",
    `default-src ${self}`,
    `script-src ${self} 'unsafe-inline'`,
    `style-src ${self} 'unsafe-inline'`,
    `img-src ${self} data:`,
    `font-src ${self} data:`,
    "connect-src 'none'",
    `form-action ${self}`,
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ")
}

/** The file of `dir` the relative path `rel` names, or null when it names none, one outside `dir`, or one no page may load. */
export function folderFile(dir: string, rel: string): string | null {
  if (!rel || rel.includes("\u0000") || isAbsolute(rel)) return null
  const root = normalize(dir.endsWith(sep) ? dir : dir + sep)
  let file = normalize(join(dir, rel))
  if (!file.startsWith(root)) return null
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html")
  if (!PAGE_TYPES[extname(file).toLowerCase()]) return null
  return existsSync(file) && statSync(file).isFile() ? file : null
}

/** A relative path of a tab's folder as the URL a frame loads it from, its segments encoded. */
export function fileUrl(key: string, tab: string, rel: string): string {
  return `/page/${key}/files/${encodeURIComponent(tab)}/${rel.split(/[\\/]/).filter((s) => s && s !== ".").map(encodeURIComponent).join("/")}`
}

/** A `ui-views` view's HTML with its own links (/view/<name>…) kept inside the page's frame. */
export function framedViewHtml(key: string, html: string): string {
  return html.split('href="/view/').join(`href="/page/${key}/view/`).split('action="/view/').join(`action="/page/${key}/view/`)
}

/** A page around a body, for a tab's { html } or a view's page in a frame: no tabs, the body and its styles. */
export function framePage(title: string, body: string, css = ""): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${esc(title)}</title>`,
    "<style>",
    "body{font-family:system-ui,sans-serif;margin:16px;line-height:1.4;color-scheme:light dark}",
    "form.pick{margin:8px 0 16px}fieldset{border:1px solid #8888;margin:0 0 8px}label{margin-right:10px;white-space:nowrap}",
    css,
    "</style></head><body>",
    body,
    "</body></html>",
  ].join("\n")
}

/** The point the ui plugin declares: every plugin's tabs, which the new UI shows beside its screens. */
export const tabsPoint = {
  id: "ui-tabs",
  says:
    "a tab of the new UI, with optional subtabs: `name`, `title`, `says`, `order` (lower first, 0 when absent), `subtabs` ([{ name, title, says? }]), `files(ctx)` (the folder its pages and frames show, or null) and `render({ sub, query }, ctx)`, which gives `{ component, data, lead? }` (component one of list, table, chart, gallery, markdown, drawn by the app), `{ page }` (a file of `files`) or `{ html, css? }`; pages are served sandboxed, and no code of the plugin runs in the app",
  noun: "ui tab",
  key: (t: UiTab) => t.name,
  validate: validateTab,
  gaps: (t: UiTab) => (blank(t.says) ? ["does not say what it shows"] : []),
}
