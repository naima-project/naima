// The UI: `naima ui` shows the views plugins contribute in a native window:
// first a screen of panels — the summary, which this plugin renders from the
// core's summary sections, the gates, what is next and the claims — then the
// tabs: the boards and the item with its evidence, which this plugin renders
// from the core's board and item data, the metrics, the session notes and the
// rest; served by a local server that lives as
// long as the window does. It is the first piece of the dashboard: a new
// plugin's view appears without this plugin knowing that plugin.
//
// The server is server.ts (loopback only, a token per run); where it is shown
// is open.ts (the window, or the browser). The launcher grants `ui`, and no
// other command, the loopback network and the programs that show it
// (docs/guide/install.md#the-permissions).

import {
  boardData,
  bool,
  type Command,
  type Context,
  CONTRACT,
  type ExtensionPoint,
  itemData,
  type ItemLink,
  label,
  parse,
  type Plugin,
  shortOrId,
  summarySections,
  table,
  typeOrThrow,
  usageError,
} from "../../core/api.ts"
import { browserCommand, denoDir, denoPath, openBrowser, type Opened, openWindow, osName, windowCommand, windowUnavailable } from "./open.ts"
import { serve, type UiView } from "./server.ts"

export type { UiRender, UiView } from "./server.ts"
export { HOST, serve } from "./server.ts"

const blank = (s: unknown): boolean => typeof s !== "string" || !s.trim()

/** The point this plugin declares: every plugin's views, which the provisional window shows as tabs. */
export const viewsPoint: ExtensionPoint<UiView> = {
  id: "ui-views",
  says:
    "a view the provisional window shows as a tab, or as a panel of its first screen: `name` (its path), `title`, `says`, `order` (lower first, 0 when absent), `panel` (true: on the first screen, not a tab), `render(params, ctx) → { data, html, css? }`, rendered at each request",
  noun: "ui view",
  key: (v) => v.name,
  validate: (v) => {
    const u = v as Partial<UiView> | null
    if (!u || typeof u !== "object") return "is not an object"
    if (typeof u.name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(u.name)) return "has no name of lowercase letters, digits and dashes"
    if (typeof u.title !== "string") return "has no title"
    if (u.order !== undefined && !Number.isFinite(u.order)) return "has an order that is not a number"
    return typeof u.render === "function" ? null : "has no render function"
  },
  gaps: (v) => (blank(v.says) ? ["does not say what it shows"] : []),
  document: (
    vs,
  ) => [
    "",
    "**UI views**, the tabs of the provisional window",
    ...table(["View", "Title", "Where", "What it shows"], vs.map((v) => [`\`${v.name}\``, v.title, v.panel ? "first screen" : "tab", v.says])),
  ],
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** The summary as a panel of the first screen: every plugin's section, rendered by the function `naima summary` renders with, so the two cannot disagree. */
export const summaryView: UiView = {
  name: "summary",
  title: "Summary",
  says: "where the project stands: every plugin's summary section, as `naima summary` prints it; its data is `naima summary --json`",
  order: -10,
  panel: true,
  async render(_params, ctx) {
    const sections = (await summarySections(ctx)).map((s) => ({ ...s, lines: s.rendering.text() }))
    const html = sections.filter((s) => s.lines.length).map((s) => `<h3>${esc(s.name)}</h3>\n<pre>${esc(s.lines.join("\n"))}</pre>`)
    return {
      data: Object.fromEntries(sections.map((s) => [s.name, s.rendering.data])),
      html: html.length ? html.join("\n") : "<p>No plugin contributes a summary section.</p>",
      css: "pre{margin:0 0 12px;white-space:pre-wrap}h3{margin:12px 0 4px;font-size:1em}",
    }
  },
}

/** An item's reference, linked to the item view, where its evidence is. */
const itemLink = (id: string, ref: string): string => `<a href="/view/item?item=${encodeURIComponent(id)}"><code>${esc(ref)}</code></a>`

/** The board of a type, picked by `?type=` (the first type that takes new items when absent), its done items too with `?all=1`: what `naima board` prints. */
export const boardView: UiView = {
  name: "board",
  title: "Boards",
  says:
    "a type's board, its open items by section, most urgent first: `?type=` picks the type (the first one that takes new items), `?all=1` adds the done ones; its data is `naima board <type> [--all] --json`",
  order: 1,
  render(params, ctx) {
    const types = [...ctx.registry.types.values()]
    const wanted = params["type"]?.[0] ?? types.find((t) => t.creatable !== false)?.id ?? types[0]?.id
    const type = typeOrThrow(ctx, wanted)
    const all = params["all"]?.[0] === "1"
    const d = boardData(ctx, type, all)
    const rows = (list: { id: string; ref: string; title: string; status: string }[]) =>
      `<table><thead><tr>${["Status", "Item", "Title"].map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${
        list.map((r) => `<tr><td>${esc(r.status)}</td><td>${itemLink(r.id, r.ref)}</td><td>${esc(r.title)}</td></tr>`).join("")
      }</tbody></table>`
    const form = [
      '<form class="pick" method="get" action="/view/board">',
      '<label for="board-type">Type</label>',
      `<select id="board-type" name="type">${
        types.map((t) => `<option value="${esc(t.id)}"${t.id === type.id ? " selected" : ""}>${esc(t.title)}</option>`).join("")
      }</select>`,
      `<label><input type="checkbox" name="all" value="1"${all ? " checked" : ""}> with the done items</label>`,
      '<button type="submit">Show</button>',
      "</form>",
    ].join("\n")
    return {
      data: d,
      html: [
        `<h1>${esc(d.title)}</h1>`,
        form,
        `<p>${d.open} open, ${d.done} done</p>`,
        ...d.sections.map((s) => `<h2>${esc(s.section || "(no section)")}</h2>\n${rows(s.items)}`),
        ...(d.closed?.length ? [`<h2>Done</h2>\n${rows(d.closed)}`] : []),
      ].join("\n"),
      css:
        "table{border-collapse:collapse;margin:0 0 12px}th,td{padding:2px 12px 2px 0;text-align:left;vertical-align:top}h2{font-size:1.1em;margin:16px 0 4px}",
    }
  },
}

/** One item, picked by `?item=`, with its evidence first — its attachments, and the items that can prove it, with whether each proves or refutes now: what `naima show` prints. */
export const itemView: UiView = {
  name: "item",
  title: "Item",
  says:
    "one item, picked by `?item=`: its evidence — its attachments and the items of a type that can prove, whether each proves or refutes now — then its fields, its other links and its prose; its data is `naima show <item> --json`, null when none is picked",
  order: 20,
  render(params, ctx) {
    const ref = params["item"]?.[0]?.trim()
    const form = [
      '<form class="pick" method="get" action="/view/item">',
      '<label for="item-ref">Item</label>',
      `<input id="item-ref" name="item" list="item-refs" value="${esc(ref ?? "")}" autocomplete="off">`,
      `<datalist id="item-refs">${ctx.repo.items.map((i) => `<option value="${esc(label(i))}">${esc(i.meta.title)}</option>`).join("")}</datalist>`,
      '<button type="submit">Show</button>',
      "</form>",
    ].join("\n")
    if (!ref) return { data: null, html: ["<h1>Item</h1>", form, "<p>Pick an item: its reference, or its id.</p>"].join("\n") }
    const d = itemData(ctx, ctx.repo.resolve(ref))
    const verdict = (l: ItemLink) => (l.refutes ? '<strong class="refutes">refutes</strong>' : l.proves ? '<strong class="proves">proves</strong>' : "not yet")
    const linkRow = (l: ItemLink, evidence: boolean) =>
      `<tr><td>${esc(l.says)}${l.implied ? " (inverse)" : ""}</td><td>${l.ref ? itemLink(l.id, l.ref) : `<code>${esc(l.id)}</code>`}</td><td>${
        esc(l.title ?? "not in the tracker")
      }</td><td>${esc(l.status ?? "")}</td>${evidence ? `<td>${verdict(l)}</td>` : ""}</tr>`
    const head = (cols: string[]) => `<thead><tr>${cols.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead>`
    const evidence = d.links.filter((l) => l.evidence)
    const others = d.links.filter((l) => !l.evidence)
    const fields = Object.entries(d.fields)
    return {
      data: d,
      html: [
        form,
        `<h1>${esc(d.title)}</h1>`,
        `<p><code>${esc(d.ref)}</code> · <strong>${esc(d.status)}</strong> · <code>${esc(d.id)}</code></p>`,
        '<h2 id="evidence">Evidence</h2>',
        d.attachments.length ? `<h3>Attachments</h3><ul>${d.attachments.map((f) => `<li><code>${esc(f)}</code></li>`).join("")}</ul>` : "<p>No attachment.</p>",
        evidence.length
          ? `<table>${head(["Relation", "Item", "Title", "Status", "Verdict"])}<tbody>${evidence.map((l) => linkRow(l, true)).join("")}</tbody></table>`
          : "<p>No linked item can prove it.</p>",
        '<h2 id="fields">Fields</h2>',
        fields.length
          ? `<dl>${fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(typeof v === "string" ? v : JSON.stringify(v))}</dd>`).join("")}</dl>`
          : "<p>No other field.</p>",
        ...(others.length
          ? [
            '<h2 id="links">Links</h2>',
            `<table>${head(["Relation", "Item", "Title", "Status"])}<tbody>${others.map((l) => linkRow(l, false)).join("")}</tbody></table>`,
          ]
          : []),
        '<h2 id="prose">Page</h2>',
        `<pre>${esc(d.readme)}</pre>`,
      ].join("\n"),
      css:
        "table{border-collapse:collapse;margin:0 0 12px}th,td{padding:2px 12px 2px 0;text-align:left;vertical-align:top}dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px}dd{margin:0}pre{white-space:pre-wrap}.proves{color:#1a7f37}.refutes{color:#cf222e}h2{font-size:1.1em;margin:16px 0 4px}",
    }
  },
}

/** Every view a loaded plugin contributes, by its order, then in load order, each served under its short name, or its qualified id when another shares it. */
export function viewsOf(ctx: Context): UiView[] {
  return ctx.registry.contributions("ui-views")
    .map((c) => ({ ...(c.value as UiView), name: shortOrId(ctx, "ui-views", c).replace("/", "-") }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

/** What `naima ui` does besides serving: each replaced by a test. */
export interface UiDeps {
  /** Why no window can open here, or null. */
  unavailable(): string | null
  window(url: string): Promise<Opened>
  browser(url: string): Promise<Opened>
  /** Resolves when the person stops `naima ui` (Ctrl-C). */
  interrupted(): Promise<void>
  /** Stop listening for Ctrl-C, once `naima ui` is done: a listener left behind would keep the process alive. */
  forget?(): void
  log?(line: string): void
}

const listening: (() => void)[] = []

export const realDeps: UiDeps = {
  unavailable: () => windowUnavailable(denoPath(), osName()),
  window: (url) => openWindow(windowCommand(denoPath()!, url, denoDir(process.env, osName()))),
  browser: (url) => openBrowser(browserCommand(osName(), url)),
  interrupted: () =>
    new Promise((done) => {
      const stop = () => done()
      listening.push(stop)
      process.once("SIGINT", stop)
      process.once("SIGTERM", stop)
    }),
  forget: () => {
    for (const stop of listening.splice(0)) {
      process.removeListener("SIGINT", stop)
      process.removeListener("SIGTERM", stop)
    }
  },
}

/** `naima ui`: serve the views, show them, and stop the server once the window closes, or on Ctrl-C. */
export async function runUi(ctx: Context, flags: { browser: boolean; open: boolean }, deps: UiDeps = realDeps): Promise<number> {
  const served = await serve(ctx, viewsOf(ctx), deps.log ? { log: deps.log } : {})
  try {
    if (!flags.open) {
      ctx.out(`naima ui: serving ${served.url} — open it in a browser; Ctrl-C stops it`)
      await deps.interrupted()
      return 0
    }
    let why = flags.browser ? null : deps.unavailable()
    if (!flags.browser && why === null) {
      const w = await deps.window(served.url)
      if (w.opened && w.how === "window") {
        ctx.out("naima ui: the Naima window is open — closing it stops the server")
        await Promise.race([w.closed, deps.interrupted().then(() => w.stop())])
        return 0
      }
      why = w.opened ? "the window did not open" : w.reason
    }
    const b = await deps.browser(served.url)
    const where = b.opened ? `opened ${served.url} in the browser` : `open ${served.url} in a browser (${b.reason})`
    ctx.out(`naima ui: ${why === null ? "" : `no window — ${why}; `}${where} — Ctrl-C stops the server`)
    await deps.interrupted()
    return 0
  } finally {
    deps.forget?.()
    await served.close()
  }
}

const uiCommand: Command = {
  name: "ui",
  says:
    "show the views the plugins contribute — first the summary, the gates, what is next and the claims, then the boards, the metrics, the session notes, each item with its evidence and the other tabs — in a native window titled Naima, served from this machine only, live from the files; closing the window stops it",
  enforces: "the views are served only on the loopback interface, and every request without this run's token is refused",
  hidden: true,
  usage: "ui [--browser | --no-open] [--log]",
  options: [
    { name: "--browser", says: "show it in the default browser instead of the window; Ctrl-C stops the server" },
    { name: "--no-open", says: "show it nowhere: print the address, with its token, and serve until Ctrl-C" },
    { name: "--log", says: "print one line per request on stderr: its status, method, path and user agent" },
  ],
  examples: ["ui", "ui --browser"],
  run(args, ctx) {
    const p = parse(args, { browser: { type: "boolean" }, "no-open": { type: "boolean" }, log: { type: "boolean" } })
    if (p.positionals.length || (bool(p, "browser") && bool(p, "no-open"))) throw usageError(this)
    return runUi(ctx, { browser: bool(p, "browser"), open: !bool(p, "no-open") }, bool(p, "log") ? { ...realDeps, log: (l) => ctx.err(l) } : realDeps)
  },
}

export default function ui(): Plugin {
  return {
    name: "ui",
    contract: CONTRACT,
    says:
      "the views plugins contribute, a provisional window onto the project, shown in a native window or the browser from a server on this machine only, until the new UI replaces it",
    about:
      "The provisional window starts a server bound to the loopback interface, on a free port, that refuses every request without the token of its run, and opens it in a native window titled Naima. " +
      "Each view is one a plugin contributes to `ui-views`, rendered from the files at each request, so the window shows what the files hold now. " +
      "The first screen holds the views that are panels — the summary, which this plugin renders from every plugin's summary section exactly as `naima summary` does; the gates, from the gates plugin, as `naima gates` reports them; what is next, from the triage plugin, as `naima view next` ranks it; the claims, from the coordination plugin, as `naima claims` recombines them — and every other view is a tab: " +
      "the boards, which this plugin renders as `naima board` does, one type at a time; the session notes across branches, from the coordination plugin, as `naima pass --list`; " +
      "one item, which this plugin renders as `naima show` does, its evidence first — its attachments and the items of a type that can prove it, each marked proves, refutes or not yet — and to which every item reference of the window links; the metrics and the others. " +
      "`/data/<view>` answers the same view's data as JSON, the same data the command prints with `--json`. Closing the window stops the server. " +
      "The window is a webview, loaded from JSR at a pinned version, only by it, and in a process of its own: the rest of Naima has no dependency. " +
      "Where it cannot open — on Node or Bun, on a system it does not run on, offline on its first run, when it fetches its library — the default browser opens instead, and it says so in one line.",
    points: [viewsPoint],
    contributes: { "ui-views": [summaryView, boardView, itemView] },
    commands: [uiCommand],
  }
}
