// The UI: `naima ui` serves the new interface (the bundle in ui/dist) in the default browser, through Naima's
// bridge commands (bridge.ts) carried by the UI stance's bridge (serve.ts), for as long as it runs. The desktop app is
// the Tauri shell around the same bundle, which starts `naima ui --sidecar` and speaks the same commands to it over
// its standard input and output (sidecar.ts). The
// interface shows the tabs plugins contribute (`ui-tabs`), and every view of `ui-views` as a tab of its own: the
// summary, which this plugin renders from the core's summary sections, the boards and the item with its evidence,
// which it renders from the core's board and item data, and the views of the other plugins. A new plugin's tab
// appears without this plugin knowing that plugin.
//
// The launcher grants `ui`, and no other command, the loopback network, the Deno that starts an action's run and
// the program that opens the browser (docs/guide/install.md#the-permissions).

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
  progressFor,
  rendered,
  shortOrId,
  str,
  type SummarySection,
  summarySections,
  table,
  typeOrThrow,
  UI_SWITCH,
  usageError,
} from "../../core/api.ts"
import { naimaBridge } from "./bridge.ts"
import { mapView } from "./graphs.ts"
import { projectsView } from "./projects.ts"
import { browserCommand, openBrowser, type Opened, osName } from "./open.ts"
import { filesKey, filesUrl, newToken, serve, type ServeOptions } from "./serve.ts"
import { resumed, switchFile, writeSwitch } from "./switch.ts"
import { runMcp } from "./mcp.ts"
import { runSidecar } from "./sidecar.ts"
import { buildDir, desktopFirst, findCargo, installDesktop, installedApp, PRODUCT } from "./desktop-app.ts"
import { desktopApp, desktopAppDirs, naimaCommand, offReason, openAtStart, register, registryDir, unregister, userAtStart } from "./at-start.ts"
import { nameStopCommand } from "./stops.ts"
import { allTabs, tabsPoint, type UiTab, type UiView } from "./tabs.ts"

export { actionArgv, ACTIONS, naimaBridge } from "./bridge.ts"
export { HOST, serve } from "./serve.ts"
export type { ComponentData, TabComponent, UiFrame, UiRender, UiSubtab, UiTab, UiTabContent, UiView } from "./tabs.ts"
export { COMPONENTS, tabsPoint } from "./tabs.ts"

const blank = (s: unknown): boolean => typeof s !== "string" || !s.trim()

/** The point this plugin declares: every plugin's views, which the new UI shows as tabs and reads the data of. */
export const viewsPoint: ExtensionPoint<UiView> = {
  id: "ui-views",
  says:
    "a view the new UI shows as a tab, and whose data the bridge's `data` command answers: `name`, `title`, `says`, `order` (lower first, 0 when absent), `moments` (true: at a commit it is rendered from the files as they are, `params.at` the commit's hash), `screen` (true: the new interface has a screen of its own for it, so it is not also one of its tabs), `render(params, ctx) → { data, html, css? }`, rendered at each request",
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
    "**UI views**, shown as tabs of the new UI",
    ...table(["View", "Title", "What it shows"], vs.map((v) => [`\`${v.name}\``, v.title, v.says])),
  ],
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** The summary: every plugin's section, rendered by the function `naima summary` renders with, so the two cannot disagree. */
export const summaryView: UiView = {
  name: "summary",
  title: "Summary",
  says: "where the project stands: every plugin's summary section, as `naima summary` prints it; its data is `naima summary --json`",
  order: -10,
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

/** The `ui-tabs` point with its reference: every plugin's tabs of the new UI. */
export const uiTabsPoint: ExtensionPoint<UiTab> = {
  ...tabsPoint,
  document: (ts) => [
    "",
    "**UI tabs**, the tabs of the new UI",
    ...table(["Tab", "Title", "Subtabs", "What it shows"], ts.map((t) => [`\`${t.name}\``, t.title, (t.subtabs ?? []).map((s) => s.title).join(", "), t.says])),
  ],
}

/** Every tab a loaded plugin contributes, by its order, then in load order, each under its short name, or its qualified id when another shares it. */
export function tabsOf(ctx: Context): UiTab[] {
  return ctx.registry.contributions("ui-tabs")
    .map((c) => ({ ...(c.value as UiTab), name: shortOrId(ctx, "ui-tabs", c).replace("/", "-") }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

/** What `naima ui` does besides serving: each replaced by a test. */
export interface UiDeps {
  browser(url: string): Promise<Opened>
  /** Resolves when the person stops `naima ui` (Ctrl-C). */
  interrupted(): Promise<void>
  /** Stop listening for Ctrl-C, once `naima ui` is done: a listener left behind would keep the process alive. */
  forget?(): void
  log?(line: string): void
  /** The file a switch to another recent project is written to, null when this run may not switch: the launcher's by default. */
  switchFile?: string | null
  /** The address a run that switched keeps: the launcher's by default, null for a run started afresh. */
  resume?: { port: number; token: string } | null
}

/** How long a run that switches serves on after answering the switch, so that the answer reaches the page, in ms. */
export const SWITCH_GRACE_MS = 300

const listening: (() => void)[] = []

export const realDeps: UiDeps = {
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

/** The folder of a tab's files now, by the tab's name: null for a tab with none, or one whose folder fails. */
export function tabFolder(ctx: Context, tabs: readonly UiTab[], name: string): string | null {
  try {
    return tabs.find((t) => t.name === name)?.files?.(ctx) ?? null
  } catch {
    return null
  }
}

/** `naima ui`: serve the UI through the bridge, open it in the browser unless asked not to, and stop on Ctrl-C. */
export async function runUi(ctx: Context, flags: { open: boolean; port?: number; token?: string }, deps: UiDeps = realDeps): Promise<number> {
  // A run that switched project from another keeps its address and token, so the page that asked finds it there.
  const back = deps.resume !== undefined ? deps.resume : resumed()
  const file = deps.switchFile !== undefined ? deps.switchFile : switchFile()
  const token = back?.token ?? flags.token ?? newToken()
  const key = filesKey(token)
  const tabs = allTabs(tabsOf(ctx), viewsOf(ctx))
  let port = 0
  let switched = () => {}
  const switching = new Promise<number>((done) => (switched = () => done(UI_SWITCH)))
  const bridge = naimaBridge(ctx, {
    views: viewsOf(ctx),
    tabs,
    fileUrl: (tab, rel) => filesUrl(key, tab, rel),
    switcher: {
      can: file !== null,
      to: (project) => {
        writeSwitch(file!, { root: project.root, port, token })
        setTimeout(switched, SWITCH_GRACE_MS)
        return Promise.resolve()
      },
    },
  })
  const options: ServeOptions = {
    ...bridge,
    token,
    tabFolder: (name) => tabFolder(ctx, tabs, name),
    ...(flags.port ? { port: flags.port } : {}),
    ...(deps.log ? { log: deps.log } : {}),
  }
  // The port the run before listened on may have been taken meanwhile: then a free one, which the address printed says.
  const served = back ? await serve({ ...options, port: back.port }).catch(() => serve(options)) : await serve(options)
  port = served.port
  // Named in the registry, so that naima hello reuses it instead of opening a second one (at-start.ts).
  const registered = register(ctx.root, { how: "browser", url: served.url })
  try {
    if (back) {
      ctx.out(`naima ui: serving ${ctx.root.split(/[\\/]/).filter(Boolean).pop() ?? ""} at ${served.url} — Ctrl-C stops it`)
    } else if (flags.open) {
      const b = await deps.browser(served.url)
      ctx.out(`naima ui: ${b.opened ? `opened ${served.url} in the browser` : `open ${served.url} in a browser (${b.reason})`} — Ctrl-C stops it`)
    } else {
      ctx.out(`naima ui: serving ${served.url} — open it in a browser; Ctrl-C stops it`)
    }
    return await Promise.race([deps.interrupted().then(() => 0), switching])
  } finally {
    unregister(registered)
    deps.forget?.()
    bridge.close()
    await served.close()
  }
}

const uiCommand: Command = {
  name: "ui",
  says:
    "open the new interface on the project: the desktop app when it is installed, its window already open there brought forward, else served in the default browser, from this machine only, live from the files: the rail, the screens and the tabs the plugins contribute — the summary, the boards, the metrics, each item with its evidence and the others; Ctrl-C stops it",
  enforces:
    "the interface is served only on the loopback interface, and every request without this run's token is refused; a bridge command comes only from the server's own page; an action runs only a command of its short list, through naima run",
  hidden: true,
  usage: "ui [--browser] [--no-open] [--log] [--port <port>] | ui --install-desktop | ui --sidecar | ui --mcp",
  long: {
    reports:
      "--install-desktop reports its stage (copy, compile, install) and, while Cargo compiles, the crates done of the count the last build ended on, on standard error or into the run's progress file",
  },
  options: [
    {
      name: "--browser",
      says:
        "serve the interface in the browser even when the desktop app is installed (naima ui opens the app on the project when it is, and brings forward its window already open there)",
    },
    {
      name: "--install-desktop",
      says:
        "build the desktop app from the shell this Naima ships and install it as Naima.app in the user's Applications folder, on macOS; it needs Rust, and its first build takes some minutes",
    },
    { name: "--no-open", says: "open no browser: print the address, with its token, and serve until Ctrl-C (for a port forwarded from another machine)" },
    { name: "--log", says: "print one line per request on stderr: its status, method and path" },
    {
      name: "--port",
      says:
        "serve on this port of the loopback interface instead of a free one; with NAIMA_UI_TOKEN in the environment, that token instead of a fresh one: how naima hello starts it, knowing its address before it listens",
    },
    {
      name: "--sidecar",
      says: "answer the bridge commands on standard input and output, one JSON object a line, with no network listener: what the desktop app's shell starts",
    },
    {
      name: "--mcp",
      says:
        "serve the bridge commands to an agent as an MCP server on standard input and output, with the tool show, which shows the owner a place in the UI open on the project: what an agent's client starts (claude mcp add naima -- naima ui --mcp)",
    },
  ],
  examples: ["ui", "ui --browser", "ui --install-desktop", "ui --no-open", "ui --sidecar", "ui --mcp"],
  async run(args, ctx) {
    const p = parse(args, {
      browser: { type: "boolean" },
      "install-desktop": { type: "boolean" },
      "no-open": { type: "boolean" },
      log: { type: "boolean" },
      sidecar: { type: "boolean" },
      mcp: { type: "boolean" },
      port: { type: "string" },
    })
    const port = str(p, "port") === undefined ? undefined : Number(str(p, "port"))
    if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) throw usageError(this)
    if (p.positionals.length || (bool(p, "sidecar") && (bool(p, "no-open") || bool(p, "log") || port !== undefined))) throw usageError(this)
    if (bool(p, "mcp") && (bool(p, "sidecar") || bool(p, "no-open") || bool(p, "log") || port !== undefined)) throw usageError(this)
    if ((bool(p, "sidecar") || bool(p, "mcp")) && (bool(p, "browser") || bool(p, "install-desktop"))) throw usageError(this)
    if (bool(p, "install-desktop")) {
      if (bool(p, "browser") || bool(p, "no-open") || bool(p, "log") || port !== undefined) throw usageError(this)
      const env = process.env
      return await installDesktop({
        product: PRODUCT,
        build: buildDir(env),
        dest: installedApp(env),
        os: osName(),
        cargo: findCargo(env),
        progress: progressFor((l) => ctx.err(l)),
        out: (l) => ctx.out(l),
        err: (l) => ctx.err(l),
      })
    }
    if (bool(p, "mcp")) {
      return runMcp(ctx, {
        views: viewsOf(ctx),
        tabs: allTabs(tabsOf(ctx), viewsOf(ctx)),
        version: "1.2",
        // A show with no UI open opens one as hello does: the desktop app when installed, else naima ui in a browser.
        openUi: async () => {
          const dir = registryDir(ctx.root)
          const naima = naimaCommand(ctx.program, ctx.trackerRoot)
          const desktop = desktopApp(desktopAppDirs(process.env, osName()))
          return dir && (desktop || naima) ? await openAtStart({ root: ctx.root, dir, app: desktop, naima: naima ?? [] }) : null
        },
        input: process.stdin,
        write: (line) => void process.stdout.write(line + "\n"),
      })
    }
    if (bool(p, "sidecar")) {
      const tabs = allTabs(tabsOf(ctx), viewsOf(ctx))
      // The desktop app's sidecar names the app in the registry, unless the hello that opened it already did.
      const registered = register(ctx.root, { how: "desktop" })
      return runSidecar(ctx, {
        views: viewsOf(ctx),
        tabs,
        tabFolder: (name) => tabFolder(ctx, tabs, name),
        os: osName(),
        input: process.stdin,
        write: (line) => void process.stdout.write(line + "\n"),
      }).finally(() => unregister(registered))
    }
    // The desktop app when it is installed, on the project; the browser when asked, when the address is wanted, or when the app cannot open.
    if (!bool(p, "browser") && !bool(p, "no-open") && port === undefined && await desktopFirst(ctx, process.env, osName())) return 0
    const token = port !== undefined ? process.env["NAIMA_UI_TOKEN"] || undefined : undefined
    return await runUi(
      ctx,
      { open: !bool(p, "no-open"), ...(port !== undefined ? { port } : {}), ...(token ? { token } : {}) },
      bool(p, "log") ? { ...realDeps, log: (l) => ctx.err(l) } : realDeps,
    )
  },
}

/** The ui plugin's option atStart: false keeps naima hello from opening the UI. */
export function readAtStart(options: Record<string, unknown>): boolean {
  const v = options["atStart"] ?? true
  if (typeof v !== "boolean") {
    throw new Error(`ui: option atStart must be true or false, whether naima hello opens the UI at a session start; got ${JSON.stringify(v)}`)
  }
  return v
}

/** What naima hello does with the UI at a session start: opens it, or reuses the one open on the project, and says so on its greeting's line. */
export const atStartSection = (on: boolean): SummarySection => ({
  name: "ui",
  render: () => rendered(null, () => []),
  async greeting(ctx) {
    const env = process.env
    if (offReason(ctx.root, env, on, userAtStart(env, osName()))) return null
    const dir = registryDir(ctx.root)
    const naima = naimaCommand(ctx.program, ctx.trackerRoot)
    const desktop = desktopApp(desktopAppDirs(env, osName()))
    if (!dir || (!desktop && !naima)) return null
    return await openAtStart({ root: ctx.root, dir, app: desktop, naima: naima ?? [] })
  },
})

export default function ui(options: Record<string, unknown> = {}): Plugin {
  const on = readAtStart(options)
  return {
    name: "ui",
    contract: CONTRACT,
    says:
      "the new interface, served in the default browser from a server on this machine only through Naima's bridge commands, and the views and tabs plugins contribute to it",
    about:
      "`naima ui` serves the new interface, the built bundle the product ships in `ui/dist`: the rail with its metro map of the lines and the goals ahead, the moment, the screens with Home and Metrics, and a tab for each view and tab the plugins contribute; its logic is generated from mCRL2 models. " +
      "It is served on the loopback interface, on a free port, to requests that carry the token of its run (in the address the browser opens, then in a cookie), so a port forwarded from another machine reaches it too. " +
      "The interface reads and acts only through Naima's bridge commands, which the UI stance's bridge carries (POST /bridge/<command>, with JSON in and out): `describe`, `data` (a view's data, the same data its command prints with `--json`; at a commit, as that commit had it, read only from its tree, a commit no local branch reaches refused; a view that places a commit itself, `moments`, read from the files as they are with the commit's full hash as its `at` parameter), `tabs`, `tab` (what a tab shows for a subtab at the moment), `metro` (the rail's map: the trunk, the open lines and the branches with their first-parent commits, each worker branch with a status derived from its branch's records — its claim, its commits, its runs, the discussions open on what it claims, its silences — and those records in words, the goals ahead per line, the people on it, the main checkout and each worktree with the commit it stands on, and the names given to stops with `naima name-stop`, which keeps each in the tracker's stops/ folder), `action` and `run`. " +
      "Its one feed, `changes` (GET /bridge/changes, server-sent events), says when the project changed (a commit, a branch moved, a tracker file written), and the interface reads again while it shows Live. " +
      "Any plugin, a stance included, adds tabs through `ui-tabs`, each with optional subtabs: for a subtab and the moment shown it gives data the interface draws with one of its own components (a list, a table, a chart, a gallery of framed pages, markdown), a page of its folder, served sandboxed under a key derived from the token, or a page it makes, which the interface frames in the same sandbox, so no code of the plugin runs in the interface; every `ui-views` view is shown as a tab too, but for one the interface has a screen of its own for (`screen`, the metrics). " +
      "`action` runs `decide`, `note`, `gate step`, `claim`, `release` or `name-stop` as a run of `naima run`, and `run` shows that run, its state, exit code and log; a bridge command is refused from any page but the server's own. " +
      "Plain `naima ui` opens the desktop app on the project when it is installed, as hello does, and brings forward its window already open on the project (a show the shell takes for itself) instead of opening a second one; it serves the browser with `--browser`, `--no-open` or `--port`, when the app is not installed (on macOS saying that `naima ui --install-desktop` installs it) and when the app cannot start. `naima ui --install-desktop` builds the app on macOS from the shell the product ships beside the bundle (ui/desktop, the Tauri project) with Rust and Tauri's command-line tool, in Naima's folder of the user's caches, kept between builds, and installs it as Naima.app in the user's Applications folder, reporting its stage and the crates compiled; the app also takes its project from its first argument. The same commands serve the desktop app, the Tauri shell around the same bundle: it starts `naima ui --sidecar` in the project's folder, which answers them on its standard input and output, one JSON object a line, pushes the feeds' events there too, and reads a tab's files for the shell's naima-files: scheme, with no network listener. " +
      "`naima ui --mcp` serves the same commands to an agent as an MCP server on standard input and output (the UI stance's bridge-mcp.ts), with one more, `show` (a screen, a plugin's view, an item, a commit or a line), which every UI open on the project hears on the feed `show` and goes to at once, a UI opened as naima hello opens one when none is: an agent shows the owner something in the UI instead of making a page of its own. " +
      "At a session start `naima hello` opens the UI on the project by itself, in the background, and says so on its greeting's line, with the address in a browser: the desktop app when it is installed, else `naima ui` on a port it picks, which opens the browser; a UI already open on the project, named in a registry in the clone's Naima state folder that `naima ui` and the sidecar write too, is reused instead. It is off with the option `atStart` false, for a user with `{\"atStart\": false}` in the ui.json of their Naima config folder, and never on CI, with NAIMA_NO_UI or NAIMA_DATA set, nor in a worktree other than the clone's main checkout.",
    points: [viewsPoint, uiTabsPoint],
    contributes: { "ui-views": [summaryView, boardView, itemView, mapView, projectsView] },
    commands: [uiCommand, nameStopCommand],
    options: [
      {
        name: "atStart",
        says:
          'false keeps naima hello from opening the UI at a session start; on, it opens the desktop app when it is installed, else naima ui in the browser, and reuses a UI already open on the project; never on CI, with NAIMA_NO_UI or NAIMA_DATA set, nor in a worktree other than the clone\'s main checkout; a user turns it off everywhere with {"atStart": false} in the ui.json of their Naima config folder',
        default: "true",
      },
    ],
    summary: [atStartSection(on)],
  }
}
