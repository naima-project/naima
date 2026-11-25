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
  isOpen,
  itemData,
  type ItemLink,
  label,
  parse,
  personAtKeyboard,
  type Plugin,
  progressFor,
  rendered,
  shortOrId,
  stateDir,
  str,
  type SummarySection,
  summarySections,
  table,
  typeOrThrow,
  UI_SWITCH,
  usageError,
  waitingOn,
  waitsOnOf,
} from "../../core/api.ts"
import { dirname, join } from "node:path"
import { commitOf } from "./at.ts"
import { viewCache } from "./view-cache.ts"
import { naimaBridge } from "./bridge.ts"
import { mapView } from "./graphs.ts"
import { projectsView } from "./projects.ts"
import { weekView } from "./week.ts"
import { browserCommand, openBrowser, type Opened, osName } from "./open.ts"
import { BUNDLE, filesKey, filesUrl, newToken, serve, type ServeOptions } from "./serve.ts"
import { studyFolder } from "./studies.ts"
import { codeFolder, uiTab } from "./study-space.ts"
import { resumed, switchFile, writeSwitch } from "./switch.ts"
import { agentChannel } from "./agent-endpoint.ts"
import { runUiMcp } from "./mcp.ts"
import { chatSide } from "./chat-channel.ts"
import { runTrackerMcp } from "./mcp-tracker.ts"
import { runSidecar } from "./sidecar.ts"
import { settle, settled, takeSeat } from "./one-server.ts"
import { remoteServer } from "./remote.ts"
import { programFeed, restartWatch } from "./restart.ts"
import { buildDir, desktopFirst, findCargo, installDesktop, installedApp, PRODUCT, realDesktopDeps } from "./desktop-app.ts"
import {
  desktopApp,
  desktopAppDirs,
  naimaCommand,
  offReason,
  openAtStart,
  processAlive,
  register,
  registryDir,
  type UiRecord,
  unregister,
  userAtStart,
} from "./at-start.ts"
import { nameStopCommand } from "./stops.ts"
import { viewPool } from "./view-pool.ts"
import { reloadWatch } from "./watch.ts"
import { allTabs, tabsPoint, type UiTab, type UiView } from "./tabs.ts"
import { withDecisionRecords } from "./design-record.ts"

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

/** Whom things wait on: the person at the keyboard, and each open item that waits on one person in particular. */
export interface PeopleData {
  /** The person at the keyboard: NAIMA_PERSON, else git's user.name; null when neither says. */
  person: string | null
  /** The person each open item waits on, by the item's reference: only those that name one. */
  waitsOn: Record<string, string>
}

export const peopleView: UiView = {
  name: "people",
  title: "People",
  says:
    "whom things wait on: the person at the keyboard and each open item that waits on one person in particular (its waitsOn field); the UI's waiting views show the person what waits on them and on nobody in particular",
  order: 25,
  render(_params, ctx) {
    const data: PeopleData = { person: personAtKeyboard(ctx.root)?.name ?? null, waitsOn: {} }
    for (const i of ctx.repo.items) {
      const on = isOpen(ctx, i) ? waitsOnOf(i) : undefined
      if (on) data.waitsOn[label(i)] = on
    }
    const rows = Object.entries(data.waitsOn)
    return {
      data,
      html: [
        "<h1>People</h1>",
        `<p>At the keyboard: ${esc(data.person ?? "nobody known")}</p>`,
        rows.length
          ? `<table><tbody>${rows.map(([ref, who]) => `<tr><td><code>${esc(ref)}</code></td><td>waits on ${esc(who)}</td></tr>`).join("")}</tbody></table>`
          : "<p>Nothing waits on one person in particular.</p>",
      ].join("\n"),
    }
  },
}

export const waitingView: UiView = {
  name: "waiting",
  title: "Waiting on you",
  says:
    "what waits on the person at the keyboard, the one list naima waiting prints and naima hello counts: each item once, a decision before a proof to give, what waits on another person left out; ?for=<name> lists another person's, ?for= everyone's",
  order: 26,
  async render(params, ctx) {
    const asked = params["for"]?.[0]
    const who = asked === undefined ? undefined : asked.trim() || null
    const rows = await waitingOn(ctx, who)
    const person = who === undefined ? personAtKeyboard(ctx.root)?.name ?? null : who
    return {
      data: { person, items: rows },
      html: [
        `<h1>Waiting on ${esc(person ?? "anyone")}</h1>`,
        rows.length
          ? `<ul>${
            rows.map((r) => `<li><code>${esc(r.ref)}</code> ${esc(r.title)} (${esc(r.why)}${r.waitsOn ? `, waits on ${esc(r.waitsOn)}` : ""})</li>`).join("")
          }</ul>`
          : "<p>Nothing waits.</p>",
      ].join("\n"),
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
    .map((t) => (t.name === "design" ? withDecisionRecords(t) : t))
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
  /** This process's id, for the registry: the real one by default. */
  pid?: number
  /** The project's registry of UIs (at-start.ts): the clone's state folder by default, null for none. */
  registry?: string | null
  /** Whether a process runs: the registry's liveness test (a record whose process does not is stale). */
  alive?(pid: number): boolean
  /** Waits `ms`: for the server a client of the same project is still starting. */
  sleep?(ms: number): Promise<void>
  /** Brings the desktop app's window on the project forward: whether one answered. */
  raise?(root: string): Promise<boolean>
  /** Restarts this server on the new program when `naima update` moved it: the polling of its file, replaced by a test. */
  restartWatch?: typeof restartWatch
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

/** How long a folder found for a tab's files is kept, in ms: a page of the app asks for a hundred files at once, and finding the folder lists the project's files. */
const FOLDER_KEPT_MS = 5_000
const folders = new Map<string, { at: number; dir: string | null }>()

/** The folder of a tab's files, by the tab's name: null for a tab with none, or one whose folder fails. */
export function tabFolder(ctx: Context, tabs: readonly UiTab[], name: string): string | null {
  if (name === "naima-study") return folderNow(ctx, tabs, name)
  const key = `${ctx.root}\0${name}`
  const kept = folders.get(key)
  if (kept && Date.now() - kept.at < FOLDER_KEPT_MS) return kept.dir
  const dir = folderNow(ctx, tabs, name)
  folders.set(key, { at: Date.now(), dir })
  return dir
}

function folderNow(ctx: Context, tabs: readonly UiTab[], name: string): string | null {
  try {
    // The Models tab's: a study's frames come from its declaring file's folder, the frame's host page from the bundle.
    if (name === "naima-study") return join(BUNDLE, "study")
    if (name.startsWith("study-code-")) return codeFolder(ctx.root, name.slice("study-code-".length))
    if (name.startsWith("study-")) return studyFolder(ctx.root, ctx.program, name.slice("study-".length))
    // The UI tab's card: the folder of the page the project builds for it (develop/ui-tab.md §3.1), read only.
    if (name === "ui-card") {
      const page = uiTab(ctx.root, ctx.program)?.card?.page
      return page ? join(ctx.root, dirname(page)) : null
    }
    return tabs.find((t) => t.name === name)?.files?.(ctx) ?? null
  } catch {
    return null
  }
}

/** The folders of the tab files this run serves, each once: what --watch watches besides the bundle. */
export function tabFolders(ctx: Context, tabs: readonly UiTab[]): string[] {
  return [...new Set(tabs.map((t) => tabFolder(ctx, tabs, t.name)).filter((d): d is string => d !== null))]
}

/** `naima ui`: serve the UI through the bridge, open it in the browser unless asked not to, and stop on Ctrl-C. */
export async function runUi(
  ctx: Context,
  flags: { open: boolean; port?: number; token?: string; watch?: boolean; browser?: boolean },
  deps: UiDeps = realDeps,
): Promise<number> {
  // A run that switched project from another keeps its address and token, so the page that asked finds it there.
  const back = deps.resume !== undefined ? deps.resume : resumed()
  // One server per project: the process that takes the seat serves; any other attaches to the live server (one-server.ts).
  // Not a run that switched (its page expects this address), nor the one naima hello started with its address and token
  // (hello's own record names it).
  const byHello = flags.port !== undefined && flags.token !== undefined
  const dir = back || byHello ? null : deps.registry !== undefined ? deps.registry : registryDir(ctx.root)
  const me = deps.pid ?? process.pid
  const seat = takeSeat(dir, me, deps.alive ?? processAlive)
  if (seat.kind === "attach") {
    // Only the desktop app is open and an address was asked for: it serves none, so a browser server runs beside it.
    const addressWanted = flags.port !== undefined || !flags.open || flags.browser === true
    if (!(seat.live.how === "desktop" && addressWanted)) return await attachRun(ctx, dir!, seat.live, flags.open, deps)
  }
  const file = deps.switchFile !== undefined ? deps.switchFile : switchFile()
  const token = back?.token ?? flags.token ?? newToken()
  const key = filesKey(token)
  const tabs = allTabs(tabsOf(ctx), viewsOf(ctx))
  // The views are rendered off the serving thread, a few at a time, so that a slow one holds no other request; its
  // workers start now, each opening the project, while the browser opens the page.
  const pool = viewPool({ root: ctx.root, data: ctx.trackerRoot, program: ctx.program })
  pool.warm()
  let port = 0
  let switched = () => {}
  const switching = new Promise<number>((done) => (switched = () => done(UI_SWITCH)))
  const bridge = naimaBridge(ctx, {
    views: viewsOf(ctx),
    tabs,
    fileUrl: (tab, rel) => filesUrl(key, tab, rel),
    // A UI opened again on a large project draws from the views kept on disk, then reads them again.
    cache: viewCache(ctx),
    pool,
    ...(deps.log ? { trace: deps.log } : {}),
    switcher: {
      can: file !== null,
      to: (project) => {
        writeSwitch(file!, { root: project.root, port, token })
        setTimeout(switched, SWITCH_GRACE_MS)
        return Promise.resolve()
      },
    },
  })
  // --watch: the pages are told to reload when the bundle or a tab's files are rebuilt, on the feed reload.
  const reloads = flags.watch ? reloadWatch({ bundle: BUNDLE, folders: () => tabFolders(ctx, tabs) }) : null
  const options: ServeOptions = {
    ...bridge,
    feeds: { ...bridge.feeds, reload: programFeed(Date.now(), reloads?.feed) },
    token,
    tabFolder: (name) => tabFolder(ctx, tabs, name),
    ...(flags.port ? { port: flags.port } : {}),
    ...(deps.log ? { log: deps.log } : {}),
  }
  // The port the run before listened on may have been taken meanwhile: then a free one, which the address printed says.
  const served = back ? await serve({ ...options, port: back.port }).catch(() => serve(options)) : await serve(options)
  port = served.port
  // Named in the registry, so that every other client attaches to it instead of starting a second one (one-server.ts).
  const named = { how: "browser", url: served.url, root: ctx.root } as const
  const registered = seat.kind === "serve" ? { dir: seat.dir, gen: seat.gen } : register(ctx.root, named)
  settle(seat, me, named)
  // naima update moved the program: this server runs the old one, so it is served again by the new one on this address.
  const restarted = (deps.restartWatch ?? restartWatch)({ root: ctx.root }, () => {
    if (file === null) return
    writeSwitch(file, { root: ctx.root, port, token })
    setTimeout(switched, SWITCH_GRACE_MS)
  })
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
    restarted.stop()
    unregister(registered, me)
    deps.forget?.()
    reloads?.stop()
    bridge.close()
    await served.close()
  }
}

/** What a client says and does when a live server of the project stands: the address, opened in a browser if wanted; the desktop window, brought forward. */
async function attachRun(ctx: Context, dir: string, live: UiRecord, open: boolean, deps: UiDeps): Promise<number> {
  const name = ctx.root.split(/[\\/]/).filter(Boolean).pop() ?? ""
  const rec = await settled(dir, live, { alive: deps.alive ?? processAlive, sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))) })
  if (rec?.how === "desktop") {
    const raised = await (deps.raise ?? realDesktopDeps.raise)(ctx.root)
    ctx.out(`naima ui: the desktop app is already open on ${name}${raised ? ": brought its window to the front" : ""}; one UI runs per project`)
  } else if (rec?.url) {
    const b = open ? await deps.browser(rec.url) : null
    ctx.out(`naima ui: already running on ${name} at ${rec.url} — ${b?.opened ? "opened it in the browser" : "open it in a browser"}; one UI runs per project`)
  } else ctx.out(`naima ui: a UI is starting on ${name}; one UI runs per project`)
  return 0
}

const uiCommand: Command = {
  name: "ui",
  says:
    "open the new interface on the project: the desktop app when it is installed, its window already open there brought forward, else served in the default browser, from this machine only, live from the files: the rail, the screens and the tabs the plugins contribute — the summary, the boards, the metrics, each item with its evidence and the others; Ctrl-C stops it",
  enforces:
    "the interface is served only on the loopback interface, and every request without this run's token is refused; a bridge command comes only from the server's own page; an action runs only a command of its short list, through naima run",
  usage: "ui [--browser] [--no-open] [--log] [--watch] [--port <port>] | ui --install-desktop | ui --sidecar | ui --mcp | ui --mcp-tracker",
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
    {
      name: "--watch",
      says:
        "for continuous testing: the window reloads by itself, keeping its screen and scroll place and saying Updated, whenever this Naima's UI is rebuilt (the bundle in ui/dist, or the files of a study's view); with the desktop app installed it opens the app on THIS Naima (its bundle and its program, an unlanded branch included) instead of the project's pinned one, in the browser it serves the page and tells it to reload; without --watch nothing is watched",
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
        "serve the UI to an agent as an MCP server on standard input and output, the server that only drives the screen: show (a place to the owner), store, transitions and transition (the open UI's central store), read_page and screenshot, every one through the agent channel to the UI open on the project; and the chat channel: what the owner brings to the chat from the UI (a right-click on any element) is written into the agent's session as a Claude Code channel event, and the tool chat_taken says the agent took it: what an agent's client starts (claude mcp add naima-ui -- naima ui --mcp)",
    },
    {
      name: "--mcp-tracker",
      says:
        "serve the tracker to an agent as an MCP server on standard input and output, the server that never touches the screen: overview, items, gates, lines, history, work, metrics, meetings, view, and the UI's actions with action and run, read from Naima's core directly: what an agent's client starts (claude mcp add naima-tracker -- naima ui --mcp-tracker)",
    },
  ],
  examples: ["ui", "ui --watch", "ui --browser", "ui --install-desktop", "ui --no-open", "ui --sidecar", "ui --mcp", "ui --mcp-tracker"],
  async run(args, ctx) {
    const p = parse(args, {
      browser: { type: "boolean" },
      "install-desktop": { type: "boolean" },
      "no-open": { type: "boolean" },
      log: { type: "boolean" },
      watch: { type: "boolean" },
      sidecar: { type: "boolean" },
      mcp: { type: "boolean" },
      "mcp-tracker": { type: "boolean" },
      port: { type: "string" },
    })
    const port = str(p, "port") === undefined ? undefined : Number(str(p, "port"))
    if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) throw usageError(this)
    if (p.positionals.length || (bool(p, "sidecar") && (bool(p, "no-open") || bool(p, "log") || port !== undefined))) throw usageError(this)
    const mcp = bool(p, "mcp") || bool(p, "mcp-tracker")
    if (bool(p, "mcp") && bool(p, "mcp-tracker")) throw usageError(this)
    if (mcp && (bool(p, "sidecar") || bool(p, "no-open") || bool(p, "log") || port !== undefined)) throw usageError(this)
    if ((bool(p, "sidecar") || mcp) && (bool(p, "browser") || bool(p, "install-desktop"))) throw usageError(this)
    if (bool(p, "watch") && (bool(p, "install-desktop") || mcp)) throw usageError(this)
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
    if (bool(p, "mcp-tracker")) {
      return runTrackerMcp(ctx, { views: viewsOf(ctx), version: "1.2", input: process.stdin, write: (line) => void process.stdout.write(line + "\n") })
    }
    if (bool(p, "mcp")) {
      const state = stateDir(ctx.root)
      return runUiMcp({
        tabs: allTabs(tabsOf(ctx), viewsOf(ctx)).map((t) => t.name),
        version: "1.2",
        channel: agentChannel(ctx.root),
        commit: (ref) => commitOf(ctx, ref),
        shotsDir: state ? join(state, "ui", "shots") : null,
        // A show with no UI open opens one as hello does: the desktop app when installed, else naima ui in a browser.
        openUi: async () => {
          const dir = registryDir(ctx.root)
          const naima = naimaCommand(ctx.program, ctx.trackerRoot)
          const desktop = desktopApp(desktopAppDirs(process.env, osName()))
          return dir && (desktop || naima) ? await openAtStart({ root: ctx.root, dir, app: desktop, naima: naima ?? [] }) : null
        },
        // The chat side: messages the owner brings from the UI reach this session as channel events (chat-channel.ts).
        chat: chatSide(ctx.root),
        input: process.stdin,
        write: (line) => void process.stdout.write(line + "\n"),
      })
    }
    if (bool(p, "sidecar")) {
      const tabs = allTabs(tabsOf(ctx), viewsOf(ctx))
      // One server per project: when a browser's server already runs on it, this sidecar is a client of that one (remote.ts);
      // else it serves, and names the app in the registry, unless the hello that opened it already did.
      const dir = registryDir(ctx.root)
      const seat = takeSeat(dir, process.pid, processAlive)
      const live = seat.kind === "attach" ? await settled(dir!, seat.live, { alive: processAlive, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }) : null
      const attached = live?.how === "browser" && live.url ? live.url : null
      const registered = attached ? null : seat.kind === "serve" ? { dir: seat.dir, gen: seat.gen } : register(ctx.root, { how: "desktop" })
      if (seat.kind === "serve") settle(seat, process.pid, { how: "desktop", root: ctx.root })
      // As in the browser's server, the views are rendered off the thread that answers the shell, side by side: the
      // window's first screen asks some twenty at once, which one thread computed one after another. The workers start now.
      const pool = attached ? null : viewPool({ root: ctx.root, data: ctx.trackerRoot, program: ctx.program })
      pool?.warm()
      return runSidecar(ctx, {
        ...(pool ? { pool } : {}),
        ...(attached ? { remote: remoteServer(attached) } : {}),
        // NAIMA_UI_TRACE=1: one line per view read, how long it took and how it was answered, on stderr.
        ...(process.env["NAIMA_UI_TRACE"] ? { trace: (line: string) => void process.stderr.write(line + "\n") } : {}),
        views: viewsOf(ctx),
        tabs,
        tabFolder: (name) => tabFolder(ctx, tabs, name),
        ...(bool(p, "watch") ? { reload: reloadWatch({ bundle: BUNDLE, folders: () => tabFolders(ctx, tabs) }) } : {}),
        os: osName(),
        input: process.stdin,
        write: (line) => void process.stdout.write(line + "\n"),
      }).finally(() => unregister(registered))
    }
    // The desktop app when it is installed, on the project; the browser when asked, when the address is wanted, or when the app cannot open.
    if (!bool(p, "browser") && !bool(p, "no-open") && port === undefined && await desktopFirst(ctx, process.env, osName(), undefined, bool(p, "watch"))) {
      return 0
    }
    const token = port !== undefined ? process.env["NAIMA_UI_TOKEN"] || undefined : undefined
    return await runUi(
      ctx,
      {
        open: !bool(p, "no-open"),
        ...(bool(p, "browser") ? { browser: true } : {}),
        ...(bool(p, "watch") ? { watch: true } : {}),
        ...(port !== undefined ? { port } : {}),
        ...(token ? { token } : {}),
      },
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
      "Its feed `changes` (GET /bridge/changes, server-sent events), says when the project changed (a commit, a branch moved, a tracker file written), and the interface reads again while it shows Live; the feeds `agent` and `show` carry what an agent asks of the open interface (below). " +
      "Any plugin, a stance included, adds tabs through `ui-tabs`, each with optional subtabs: for a subtab and the moment shown it gives data the interface draws with one of its own components (a list, a table, a chart, a gallery of framed pages, markdown), a page of its folder, served sandboxed under a key derived from the token, or a page it makes, which the interface frames in the same sandbox, so no code of the plugin runs in the interface; every `ui-views` view is shown as a tab too, but for one the interface has a screen of its own for (`screen`, the metrics). " +
      "`action` runs `decide`, `note`, `gate step`, `claim`, `release` or `name-stop` as a run of `naima run`, and `run` shows that run, its state, exit code and log; a bridge command is refused from any page but the server's own. " +
      "Plain `naima ui` opens the desktop app on the project when it is installed, as hello does, and brings forward its window already open on the project (a show the shell takes for itself) instead of opening a second one; it serves the browser with `--browser`, `--no-open` or `--port`, when the app is not installed (on macOS saying that `naima ui --install-desktop` installs it) and when the app cannot start. `naima ui --install-desktop` builds the app on macOS from the shell the product ships beside the bundle (ui/desktop, the Tauri project) with Rust and Tauri's command-line tool, in Naima's folder of the user's caches, kept between builds, and installs it as Naima.app in the user's Applications folder, reporting its stage and the crates compiled; the app also takes its project from its first argument. The same commands serve the desktop app, the Tauri shell around the same bundle: it starts `naima ui --sidecar` in the project's folder, which answers them on its standard input and output, one JSON object a line, pushes the feeds' events there too, and reads a tab's files for the shell's naima-files: scheme, with no network listener. " +
      "Two MCP servers serve an agent on standard input and output, split by what they touch. `naima ui --mcp` (the UI stance's bridge-mcp.ts) drives the screen the way a person does, and imports only the UI stance's registry and its agent channel (agent-endpoint.ts): `show` (a screen, a plugin's view, an item, a commit or a line), `store`, `transitions` and `transition`, `read_page` and `screenshot` all ask every UI open on the project on the feed `agent` (the request `{ id, tool, args }` of the UI stance's agent protocol, answered on the command `agent-answer` as `{ id, ok, answer }` or `{ id, ok: false, error }`), one request at a time; a show opens a UI as naima hello opens one when none is, so that an agent shows the owner something in the UI instead of making a page of its own. `naima ui --mcp-tracker` never touches the screen: it reads Naima's core directly (the views, the lines' map, git) for `overview`, `items`, `gates`, `lines`, `history`, `work`, `metrics`, `meetings` and `view`, and runs the UI's actions with `action` and `run`. " +
      "At a session start `naima hello` opens the UI on the project by itself, in the background, and says so on its greeting's line, with the address in a browser: the desktop app when it is installed, else `naima ui` on a port it picks, which opens the browser; a UI already open on the project, named in a registry in the clone's Naima state folder that `naima ui` and the sidecar write too, is reused instead. At most one UI server runs per project on a machine: whoever would serve it (`naima ui`, the desktop app's sidecar, the MCP server's show) takes the registry's next record first, and every other attaches to the live server instead of starting one (`naima ui` says its address and opens it, the sidecar asks it over HTTP, the MCP server's requests reach it through the state folder), a record whose process is dead being replaced. `naima update` says in the state folder that the program moved: the live server then restarts on the new program on the same address (the desktop app's shell starts its sidecar again) and its page reloads. A window names its project in the top bar, and a quiet agent is named by its branch and the items it holds. It is off with the option `atStart` false, for a user with `{\"atStart\": false}` in the ui.json of their Naima config folder, and never on CI, with NAIMA_NO_UI or NAIMA_DATA set, nor in a worktree other than the clone's main checkout.",
    points: [viewsPoint, uiTabsPoint],
    contributes: { "ui-views": [summaryView, boardView, itemView, peopleView, waitingView, mapView, projectsView, weekView] },
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
