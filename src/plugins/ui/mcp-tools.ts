// The tools an agent reads the project through, over `naima ui --mcp` (mcp.ts): each answers like a screen at a
// glance, a few lines of plain text, and gives the details of one thing by its id. They read the views the UI reads
// (through the bridge's data and metro) and only shape the answer for an agent with a budget of tokens:
//
//   overview                     the project at a glance: items open, gates, lines, next up, who works, what is at risk
//   items {ref | query, type, status, gate, open, limit, offset, detail}   one item by its ref, or a search with counts
//   gates {name, detail}         every gate in a line each, or one gate: why it is blocked, by what
//   lines {name}                 the trunk, the lines and the branches, or one: its place, its goals, its last commits
//   history {day | commit}       the last days in a line each, or one day, or one commit
//   work {worker}                claims, queue, stale work and what is at risk, or one worker
//   metrics {name}               every metric's value and trend, or one metric's recent points
//   view {view, ...}             a view's raw data, in pages: what no tool above answers
//
// A bare call answers in about 2 000 characters at most; nothing answers more than HARD_BOUND, and a reply cut there
// says how to narrow it. Commit hashes are shortened to SHA_LENGTH characters, which git takes as they are.

import type { Json } from "./bridge-handler.ts"

/** The most characters any reply takes: a safety net, never the normal case. */
export const HARD_BOUND = 20_000
/** The characters a hash is shortened to. */
export const SHA_LENGTH = 10
/** Entries a list shows when the call does not say, and at most. */
export const LIST_LIMIT = 10
export const LIST_MAX = 50

type O = { [k: string]: Json }
const obj = (v: Json | undefined): O => (typeof v === "object" && v !== null && !Array.isArray(v) ? v : {})
const arr = (v: Json | undefined): Json[] => (Array.isArray(v) ? v : [])
const str = (v: Json | undefined): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v))
const num = (v: Json | undefined): number => (typeof v === "number" ? v : 0)
const get = (v: Json | undefined, ...keys: string[]): Json | undefined => keys.reduce<Json | undefined>((x, k) => obj(x)[k], v)

/** A text cut to `n` characters, with an ellipsis when cut. */
export const cut = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1)).trimEnd()}…`)
const sha = (h: Json | undefined): string => str(h).slice(0, SHA_LENGTH)
const day = (v: Json | undefined): string => str(v).slice(0, 10)
/** The first `n` of a list, and how many more. */
const refList = (list: string[], n: number) => list.slice(0, n).join(", ") + (list.length > n ? ` +${list.length - n}` : "")
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const hours = (minutes: number) => (minutes >= 120 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes)} min`)

/** A reply held to HARD_BOUND: cut at a line's end, saying how to narrow it. */
export function bounded(text: string, narrow: string): string {
  const size = (t: string) => JSON.stringify(t).length
  if (size(text) <= HARD_BOUND) return text
  const note = `\n[cut: ${text.length} characters is past the bound of ${HARD_BOUND}; ${narrow}]`
  // The bound holds for the text as the reply carries it, escapes included.
  let room = HARD_BOUND - note.length - 2
  while (room > 0 && size(text.slice(0, room) + note) > HARD_BOUND) room = Math.floor(room * 0.9)
  const end = text.lastIndexOf("\n", room)
  return text.slice(0, end > room / 2 ? end : room) + note
}

/** Counts of the values, the most frequent first: "a 3, b 1", the first `n` of them. */
export function counts(values: string[], n = 6): string {
  const m = new Map<string, number>()
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1)
  const all = [...m].sort((x, y) => y[1] - x[1])
  return all.slice(0, n).map(([k, c]) => `${k} ${c}`).join(", ") + (all.length > n ? `, ${all.length - n} more` : "")
}

/** Compact JSON for detail "full", held to the bound. */
const full = (v: unknown, narrow: string): string => bounded(JSON.stringify(v), narrow)

/** What the tools read: the UI's views and its map, and a commit as git tells it. */
export interface Reader {
  view(name: string, query?: Record<string, string>): Promise<Json>
  metro(): Promise<Json>
  /** A commit by a hash or a ref: null when git knows none. */
  commit(ref: string): { hash: string; date: string; subject: string; body: string; files: string[] } | null
  /** The project's name, and today as a date. */
  name: string
  today(): string
}

const str_ = (description: string) => ({ type: "string", description })
const int_ = (description: string) => ({ type: "integer", minimum: 0, description })
const detail_ = { type: "string", enum: ["brief", "full"], description: "brief (default): a few lines; full: the whole record as compact JSON" }
const schema = (properties: Record<string, unknown> = {}) => ({ type: "object", properties })

/** The tools, with what each is for: their descriptions are what an agent chooses by. */
export const TOOL_SPECS: { [name: string]: { description: string; inputSchema: { [k: string]: Json } } } = {
  overview: {
    description: "The project at a glance, in about 1 500 characters: items open by type, gates, lines, next up, who works, what is at risk. Start here.",
    inputSchema: schema() as { [k: string]: Json },
  },
  items: {
    description:
      "One item by its ref (type/slug; the slug or the id's start will do), or a search: counts and one line per item (ref, status, gate, title). Filters combine.",
    inputSchema: schema({
      ref: str_("one item: its ref, slug or id prefix"),
      query: str_("words in the ref or the title"),
      type: str_("bugs, features, todos, tests, ... (default: every type)"),
      status: str_("its status, such as open, fixed, closed"),
      gate: str_("the gate it belongs to; none for no gate"),
      open: { type: "boolean", description: "true: open items only; false: closed only" },
      limit: int_(`lines shown, default ${LIST_LIMIT}, at most ${LIST_MAX}`),
      offset: int_("the first line shown, for the next page"),
      detail: detail_,
    }) as { [k: string]: Json },
  },
  gates: {
    description: "Every gate in a line each (holds, or blocked by how many), or one gate by name: why it is blocked, by what, what is owed.",
    inputSchema: schema({ name: str_("one gate, such as release-1.2"), limit: int_(`blocking items listed, default ${LIST_LIMIT}`), detail: detail_ }) as {
      [k: string]: Json
    },
  },
  lines: {
    description: "The trunk, the lines and the branches in a line each, or one by name: its fork, tip, landing, goals and last commits.",
    inputSchema: schema({ name: str_("one route: main, line/release-1.2, worker/x"), limit: int_("last commits shown, default 5") }) as { [k: string]: Json },
  },
  history: {
    description: "What happened: the last days in a line each (commits, items filed and closed, diary entries), or one day, or one commit by hash or ref.",
    inputSchema: schema({
      day: str_("one day, 2026-11-09"),
      commit: str_("one commit: a hash (its start will do) or a ref"),
      days: int_("days in the bare answer, default 7"),
    }) as {
      [k: string]: Json
    },
  },
  work: {
    description: "Who works on what: claims with their step and silence, the ready queue, stale work and unpushed work at risk; or one worker by branch.",
    inputSchema: schema({ worker: str_("one worker's branch, such as worker/x") }) as { [k: string]: Json },
  },
  meetings: {
    description:
      "The meetings with the owner in a line each (taken now, dated by date, then those waiting, with how many items on each), or one meeting by name with its agenda in order. To schedule, move or take one, use action: meeting-new, meeting-add, meeting-move, meeting-off, meeting-date, meeting-take.",
    inputSchema: schema({ name: str_("one meeting, such as owner") }) as { [k: string]: Json },
  },
  metrics: {
    description: "Every metric's latest value, change and trend in a line each, or one metric by name with its recent points.",
    inputSchema: schema({ name: str_("one metric, such as tests"), limit: int_("points shown, default 12") }) as { [k: string]: Json },
  },
}

/** The tools' answers, by name. */
export function agentTools(r: Reader): { [name: string]: (args: O) => Promise<string> } {
  return {
    overview: () => overview(r),
    items: (a) => items(r, a),
    gates: (a) => gates(r, a),
    lines: (a) => lines(r, a),
    history: (a) => history(r, a),
    work: (a) => work(r, a),
    metrics: (a) => metrics(r, a),
    meetings: (a) => meetings(r, a),
  }
}

// meetings

const MEETING_STATE: Record<string, string> = { taken: "taken now", scheduled: "scheduled", waiting: "waiting, no date", held: "held" }

async function meetings(r: Reader, a: O): Promise<string> {
  const all = arr(get(await r.view("meetings"), "meetings")).map(obj)
  const name = textArg(a, "name")
  const line = (m: O) =>
    `${str(m["name"])}: ${MEETING_STATE[str(m["state"])] ?? str(m["state"])}${m["on"] ? ` · ${str(m["on"])}` : ""} · ${
      plural(arr(m["agenda"]).length, "item")
    } · ${cut(str(m["title"]), 60)}`
  if (!name) return all.length ? all.map(line).join("\n") : 'no meetings: declare one with action meeting-new ["<name>", "<title>"]'
  const m = all.find((x) => str(x["name"]) === name)
  if (!m) throw new Error(`no meeting ${name}; the meetings: ${all.map((x) => str(x["name"])).join(", ") || "none"}`)
  const agenda = arr(m["agenda"]).map(obj)
  return [
    line(m),
    ...(m["taken"] ? [`taken at ${str(m["taken"])}`] : []),
    ...agenda.map((i, n) => `  ${n + 1}. ${str(i["ref"])} · ${cut(str(i["title"]), 70)}`),
  ]
    .join("\n")
}

const limitOf = (a: O, dflt: number, max = LIST_MAX) => {
  const v = a["limit"]
  if (v === undefined || v === null) return dflt
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new Error("limit is a whole number from 1")
  return Math.min(v, max)
}
const textArg = (a: O, k: string): string | null => (typeof a[k] === "string" && str(a[k]).trim() ? str(a[k]).trim() : null)

// overview

async function overview(r: Reader): Promise<string> {
  const [s, m] = await Promise.all([r.view("summary"), r.metro()])
  const out: string[] = []
  const where = obj(get(s, "where we were"))
  out.push(`${r.name} · on ${str(get(m, "head")) || "?"} · trunk ${str(get(m, "trunk"))} · ${r.today()}`)
  const types = arr(get(s, "items")).map(obj).filter((t) => num(t["open"]) > 0)
  out.push(`open: ${types.map((t) => `${str(t["type"])} ${num(t["open"])}`).join(", ") || "nothing"}`)
  const nu = obj(get(s, "next up"))
  if (num(nu["untriaged"]) || num(nu["unsized"])) out.push(`untriaged ${num(nu["untriaged"])}, unsized ${num(nu["unsized"])}`)
  const gs = arr(get(s, "gates")).map(obj)
  const blocked = gs.filter((g) => !g["holds"])
  const due = (w: Json | undefined) => /due (\d{4}-\d{2}-\d{2})/.exec(str(w))?.[1]
  out.push(
    `gates blocked: ${
      blocked.map((g) => `${str(g["gate"])} by ${arr(g["blocking"]).length}${due(g["when"]) ? ` (due ${due(g["when"])})` : ""}`).join(", ") || "none"
    }${gs.length > blocked.length ? `; ${gs.length - blocked.length} hold` : ""}`,
  )
  const goals = obj(get(m, "goals"))
  for (const l of arr(get(s, "lines", "lines")).map(obj)) {
    const next = arr(goals[str(l["branch"])]).map(obj).find((g) => g["kind"] === "step" && g["state"] === "next")
    out.push(
      `${str(l["branch"])}: ${num(l["ahead"])} ahead, ${num(l["behind"])} behind the trunk${next ? `; next step ${cut(str(next["title"]), 60)}` : ""}`,
    )
  }
  const next = arr(nu["next"]).map(obj).slice(0, 5)
  if (next.length) out.push("next up:", ...next.map((n) => `  ${str(n["ref"])} (${[n["priority"], n["impact"]].filter(Boolean).join(", ")})`))
  const hand = arr(get(s, "in hand")).map(obj)
  const queue = obj(get(s, "ready queue"))
  const stale = arr(get(s, "stale work"))
  out.push(
    `work: ${plural(hand.length, "claim")}${hand.filter((h) => h["silent"]).length ? ` (${hand.filter((h) => h["silent"]).length} silent)` : ""}, ${
      num(queue["free"])
    } of ${num(queue["maxWorkers"])} slots free, ${stale.length} stale`,
  )
  const risk = arr(get(s, "at-risk")).map(obj)
  if (risk.length) out.push(`at risk: ${risk.map((x) => `${str(x["name"])} ${num(x["count"])}`).join(", ")}`)
  const waiting = arr(get(s, "closing", "waiting"))
  if (waiting.length) out.push(`waiting for the owner's proof: ${waiting.length}`)
  const worse = arr(get(s, "metrics")).map(obj).filter((x) => x["change"] === "worse" || x["holds"] === false)
  if (worse.length) {
    out.push(
      `metrics worse: ${worse.map((x) => `${str(x["metric"])} ${str(x["value"]) || "none"}${str(x["was"]) ? ` (was ${str(x["was"])})` : ""}`).join(", ")}`,
    )
  }
  if (where["date"]) out.push(`last session note: ${day(where["date"])} on ${str(where["branch"])}`)
  return out.join("\n")
}

// items

/** The item types the project has, from the summary's counts. */
async function typesOf(r: Reader): Promise<string[]> {
  return arr(get(await r.view("summary"), "items")).map((t) => str(get(t, "type"))).filter(Boolean)
}

async function rowsOf(r: Reader, type: string | null): Promise<O[]> {
  const types = type ? [type] : await typesOf(r)
  const all = await Promise.all(types.map(async (t) => arr(get(await r.view("items", { type: t }), "items")).map(obj)))
  return all.flat()
}

const itemLine = (i: O) => `${str(i["ref"])} · ${str(i["status"])}${i["gate"] ? ` · ${str(i["gate"])}` : ""} · ${cut(str(i["title"]), 90)}`

async function items(r: Reader, a: O): Promise<string> {
  const ref = textArg(a, "ref")
  if (ref) return item(r, ref, a["detail"] === "full")
  const type = textArg(a, "type")
  let rows = await rowsOf(r, type)
  const total = rows.length
  const query = textArg(a, "query")?.toLowerCase()
  const status = textArg(a, "status")?.toLowerCase()
  const gate = textArg(a, "gate")?.toLowerCase()
  if (query) {
    const words = query.split(/\s+/)
    rows = rows.filter((i) => words.every((w) => `${str(i["ref"])} ${str(i["title"])}`.toLowerCase().includes(w)))
  }
  if (status) rows = rows.filter((i) => str(i["status"]).toLowerCase() === status || str(i["lifecycle"]).toLowerCase() === status)
  if (gate) rows = rows.filter((i) => (gate === "none" ? !i["gate"] : str(i["gate"]).toLowerCase() === gate))
  if (typeof a["open"] === "boolean") rows = rows.filter((i) => Boolean(i["open"]) === a["open"])
  const filtered = Boolean(query || status || gate || typeof a["open"] === "boolean")
  if (a["detail"] === "full") return full(rows.slice(0, limitOf(a, LIST_LIMIT)), "narrow with query, type, status, gate or open, or lower limit")
  const offset = typeof a["offset"] === "number" && a["offset"] > 0 ? a["offset"] : 0
  // A bare list shows the most recent open items first; a search, in the tracker's order.
  const order = filtered ? rows : [...rows].filter((i) => i["open"]).sort((x, y) => str(y["created"]).localeCompare(str(x["created"])))
  const page = order.slice(offset, offset + limitOf(a, LIST_LIMIT))
  const head = `${rows.length}${filtered ? ` of ${total}` : ""} ${type ?? "items"}: ${counts(rows.map((i) => str(i["status"])))}`
  const shown = page.length ? `${filtered ? "" : `the ${order.length} open ones, newest first:\n`}${page.map(itemLine).join("\n")}` : "none"
  const more = offset + page.length < order.length ? `\n[${order.length - offset - page.length} more: offset ${offset + page.length}]` : ""
  return bounded(`${head}\n${shown}${more}`, "lower limit or narrow with query, type, status or gate")
}

async function item(r: Reader, ref: string, wantFull: boolean): Promise<string> {
  let found = ref.includes("/") ? ref : null
  if (!found) {
    const rows = await rowsOf(r, null)
    const hits = rows.filter((i) => str(i["ref"]).split("/").pop() === ref || str(i["id"]).startsWith(ref))
    if (hits.length > 1) return `${ref} names ${hits.length} items:\n${hits.slice(0, LIST_LIMIT).map(itemLine).join("\n")}`
    found = hits[0] ? str(hits[0]["ref"]) : null
    if (!found) {
      const near = rows.filter((i) => str(i["ref"]).includes(ref)).slice(0, 5)
      throw new Error(`no item ${ref}${near.length ? `; near: ${near.map((i) => str(i["ref"])).join(", ")}` : ""}`)
    }
  }
  const it = obj(await r.view("item", { item: found }))
  if (!it["ref"]) throw new Error(`no item ${ref}: give its ref as type/slug, or search with query`)
  if (wantFull) return full(it, "read the brief answer, without detail full")
  const f = obj(it["fields"])
  const keep = ["gate", "priority", "impact", "effort", "created", "triagedOn", "fixedOn", "closedOn", "due", "epic"]
  const fields = keep.filter((k) => f[k] !== undefined && f[k] !== null && typeof f[k] !== "object").map((k) => `${k} ${str(f[k])}`)
  const out = [`${str(it["ref"])} · ${str(it["type"])} · ${str(it["status"])}`, str(it["title"]), fields.join(" · ")]
  const links = arr(it["links"]).map(obj)
  if (links.length) out.push(`links: ${links.slice(0, 10).map((l) => `${str(l["kind"] ?? l["rel"])} ${str(l["ref"] ?? l["to"])}`.trim()).join(", ")}`)
  const facts = arr(it["facts"])
  if (facts.length) out.push(`facts: ${facts.length}`)
  const readme = str(it["readme"]).replace(/^# .*\n+/, "").trim()
  if (readme) out.push(cut(readme, 900))
  return out.filter(Boolean).join("\n")
}

// gates

async function gates(r: Reader, a: O): Promise<string> {
  const all = arr(await r.view("gates")).map(obj)
  const name = textArg(a, "name")
  if (!name) {
    const open = all.filter((g) => !g["finished"])
    const lines = open.map((g) =>
      `${str(g["gate"])}: ${g["holds"] ? "holds" : `blocked by ${arr(g["blocking"]).length}`}${
        arr(g["owed"]).length ? `, ${arr(g["owed"]).length} owe proof` : ""
      }${g["when"] ? ` · ${str(g["when"])}` : ""} · ${cut(str(g["title"]), 50)}`
    )
    const done = all.length - open.length
    const shown = lines.slice(0, 12)
    if (lines.length > shown.length) shown.push(`[${lines.length - shown.length} more open: ${open.slice(12).map((g) => str(g["gate"])).join(", ")}]`)
    return cut([...shown, ...(done ? [`${done} finished: ${all.filter((g) => g["finished"]).map((g) => str(g["gate"])).join(", ")}`] : [])].join("\n"), 2000)
  }
  const g = all.find((x) => str(x["gate"]) === name)
  if (!g) throw new Error(`no gate ${name}; the gates: ${all.map((x) => str(x["gate"])).join(", ")}`)
  if (a["detail"] === "full") return full(g, "read the brief answer, or items with gate for its items")
  const blocking = arr(g["blocking"]).map(obj)
  const owed = arr(g["owed"]).map(obj)
  const n = limitOf(a, LIST_LIMIT)
  const out = [
    `${str(g["gate"])} · ${cut(str(g["title"]), 80)} · ${g["holds"] ? "holds" : "blocked"}${g["when"] ? ` · ${str(g["when"])}` : ""} · ${
      num(g["items"])
    } items`,
    ...arr(g["reasons"]).map((x) => cut(str(x), 300)),
  ]
  if (blocking.length) {
    out.push(`blocked by ${blocking.length}:`, ...blocking.slice(0, n).map((i) => `  ${str(i["ref"])} · ${cut(str(i["title"]), 60)}`))
    if (blocking.length > n) out.push(`  [${blocking.length - n} more: limit, or items with gate ${name} and a query]`)
  }
  if (owed.length) out.push(`owe proof: ${owed.length}: ${owed.slice(0, 5).map((i) => str(i["ref"])).join(", ")}${owed.length > 5 ? ", …" : ""}`)
  const before = arr(g["before"])
  if (before.length) out.push(`after: ${before.map(str).join(", ")}`)
  return bounded(out.join("\n"), "lower limit")
}

// lines

async function lines(r: Reader, a: O): Promise<string> {
  const m = obj(await r.metro())
  const routes = arr(m["routes"]).map(obj)
  const commits = obj(m["commits"])
  const name = textArg(a, "name")
  const goals = obj(m["goals"])
  if (!name) {
    // The trunk and the lines first; the branches after them, as many as fit a glance.
    const branch = (x: O) => Number(!["trunk", "line"].includes(str(x["kind"])))
    const ordered = [...routes].sort((x, y) => branch(x) - branch(y))
    const out = ordered.slice(0, 15).map((x) =>
      `${str(x["name"])} · ${str(x["kind"])}${x["gate"] ? ` for ${str(x["gate"])}` : ""} · ${plural(arr(x["commits"]).length, "commit")} · tip ${
        sha(x["tip"])
      }${x["land"] ? " · landed" : ""}`
    )
    if (ordered.length > 15) out.push(`[${ordered.length - 15} more routes: ${cut(ordered.slice(15).map((y) => str(y["name"])).join(", "), 300)}]`)
    const workers = arr(m["workers"]).map(obj)
    if (workers.length) out.push(`workers: ${workers.map((w) => str(w["branch"] ?? w["name"])).join(", ")}`)
    const co = arr(m["checkouts"]).map(obj)
    const dirty = co.filter((c) => num(c["dirty"]) > 0)
    out.push(`checkouts: ${co.length}${dirty.length ? `, ${dirty.length} with uncommitted changes (${dirty.map((c) => str(c["name"])).join(", ")})` : ""}`)
    return bounded(out.join("\n"), "name one route")
  }
  const x = routes.find((y) => str(y["name"]) === name)
  if (!x) throw new Error(`no route ${name}; the routes: ${routes.map((y) => str(y["name"])).join(", ")}`)
  const list = arr(x["commits"]).map(str)
  const n = limitOf(a, 5)
  const out = [
    `${name} · ${str(x["kind"])}${x["gate"] ? ` for ${str(x["gate"])}` : ""}${x["base"] ? ` · from ${str(x["base"])}` : ""} · ${plural(list.length, "commit")}`,
    `tip ${sha(x["tip"])}${x["fork"] ? ` · forked at ${sha(x["fork"])}` : ""}${x["land"] ? ` · landed as ${sha(x["land"])}` : ""}`,
  ]
  const gs = arr(goals[name]).map(obj)
  if (gs.length) out.push(`goals: ${gs.map((g) => `${str(g["id"])} ${str(g["state"])}`).join("; ")}`)
  out.push(
    "last commits:",
    ...list.slice(0, n).map((h) => {
      const c = obj(commits[h])
      return `  ${sha(h)} ${c["t"] ? new Date(num(c["t"]) * 1000).toISOString().slice(0, 16).replace("T", " ") : ""} ${cut(str(c["subject"]), 90)}`
    }),
  )
  if (list.length > n) out.push(`  [${list.length - n} more: history day <date> or commit <hash>]`)
  return bounded(out.join("\n"), "lower limit")
}

// history

async function history(r: Reader, a: O): Promise<string> {
  const ref = textArg(a, "commit")
  if (ref) return commit(r, ref)
  const [d, m] = await Promise.all([r.view("diary"), r.metro()])
  const commits = Object.entries(obj(get(m, "commits"))).map(([h, c]) => ({ h, t: num(get(c, "t")), subject: str(get(c, "subject")) }))
  const dayOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10)
  const entries = arr(get(d, "entries")).map(obj)
  const filed = arr(get(d, "filed")).map(obj)
  const closed = arr(get(d, "closed")).map(obj)
  const one = textArg(a, "day")
  if (one) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(one)) throw new Error("day is a date, such as 2026-11-09")
    const cs = commits.filter((c) => dayOf(c.t) === one).sort((x, y) => x.t - y.t)
    const es = entries.filter((e) => day(e["date"]) === one)
    const f = filed.filter((e) => day(e["date"]) === one)
    const c = closed.filter((e) => day(e["date"]) === one)
    const out = [`${one}: ${plural(cs.length, "commit")}, ${f.length} filed, ${c.length} closed, ${plural(es.length, "diary entry", "diary entries")}`]
    for (const e of es.slice(0, 5)) out.push(`${str(e["kind"])}: ${cut(str(e["text"]), 240)}`)
    if (es.length > 5) out.push(`[${es.length - 5} more entries: view diary, path entries, since and until ${one}]`)
    const refs = (label: string, list: O[]) => {
      if (list.length) out.push(`${label}: ${list.slice(0, 12).map((i) => str(i["ref"])).join(", ")}${list.length > 12 ? `, ${list.length - 12} more` : ""}`)
    }
    refs("closed", c)
    refs("filed", f)
    if (cs.length) out.push("last commits:", ...cs.slice(-10).reverse().map((x) => `  ${sha(x.h)} ${cut(x.subject, 80)}`))
    if (cs.length > 10) out.push(`  [${cs.length - 10} earlier: commit <hash> reads one; lines name <route> lists a route's]`)
    return bounded(out.join("\n"), "read one commit with commit")
  }
  const n = limitOf(a, 7, 60)
  const days = new Map<string, { c: number; f: number; x: number; e: string[] }>()
  const at = (k: string) => days.get(k) ?? days.set(k, { c: 0, f: 0, x: 0, e: [] }).get(k)!
  for (const c of commits) if (c.t) at(dayOf(c.t)).c++
  for (const e of filed) at(day(e["date"])).f++
  for (const e of closed) at(day(e["date"])).x++
  for (const e of entries) at(day(e["date"])).e.push(str(e["kind"]))
  const recent = [...days.keys()].filter(Boolean).sort().reverse().slice(0, n)
  const out = recent.map((k) => {
    const v = days.get(k)!
    return `${k}: ${plural(v.c, "commit")}, ${v.f} filed, ${v.x} closed${v.e.length ? `; diary: ${counts(v.e)}` : ""}`
  })
  const tags = arr(get(d, "releases")).map(obj)
  if (tags.length) out.push(`releases: ${tags.slice(-3).map((t) => `${str(t["tag"])} ${day(t["date"])}`).join(", ")}`)
  return out.join("\n")
}

async function commit(r: Reader, ref: string): Promise<string> {
  const c = r.commit(ref)
  if (!c) throw new Error(`no commit ${ref}`)
  const m = obj(await r.metro())
  const on = arr(m["routes"]).map(obj).filter((x) => arr(x["commits"]).some((h) => str(h) === c.hash)).map((x) => str(x["name"]))
  const out = [`${sha(c.hash)} · ${c.date.slice(0, 16).replace("T", " ")}${on.length ? ` · on ${on.join(", ")}` : ""}`, c.subject]
  const body = c.body.split("\n").filter((l) => !/^(Co-Authored-By|Signed-off-by):/i.test(l)).join("\n").trim()
  if (body) out.push(cut(body, 1200))
  if (c.files.length) {
    const dirOf = (f: string) => (f.includes("/") ? f.split("/").slice(0, -1).slice(0, 3).join("/") + "/" : f)
    out.push(`${plural(c.files.length, "file")}: ${c.files.length <= 8 ? c.files.join(", ") : counts(c.files.map(dirOf), 6)}`)
  }
  return out.join("\n")
}

// work

async function work(r: Reader, a: O): Promise<string> {
  const [s, cl] = await Promise.all([r.view("summary"), r.view("claims")])
  const claims = arr(get(cl, "claims")).map(obj)
  const stale = arr(get(s, "stale work")).map(obj)
  const worker = textArg(a, "worker")
  if (worker) {
    const c = claims.find((x) => str(x["branch"]) === worker)
    const st = stale.find((x) => str(x["branch"]) === worker)
    if (!c && !st) throw new Error(`no worker ${worker}; claims: ${claims.map((x) => str(x["branch"])).join(", ") || "none"}`)
    const out = [worker]
    if (c) {
      out.push(`claimed ${day(c["claimedAt"])}${c["silent"] ? ", silent" : ""}, quiet for ${hours(num(c["quietFor"]))}`)
      const step = obj(c["step"])
      if (step["what"]) out.push(`step: ${cut(str(step["what"]), 200)} (since ${str(step["since"]).slice(0, 16).replace("T", " ")})`)
      out.push(...arr(c["items"]).map(obj).map((i) => `  ${str(i["ref"])} · ${cut(str(i["title"]), 80)}`))
    }
    if (st) out.push(`stale: next ${str(st["next"])}, ${arr(st["why"]).map(str).join("; ")}`)
    return out.join("\n")
  }
  const out = claims.length
    ? claims.slice(0, 8).map((c) =>
      `${str(c["branch"])}: ${refList(arr(c["items"]).map((i) => str(get(i, "ref"))), 2)} · ${c["silent"] ? "silent" : "active"}, quiet ${
        hours(num(c["quietFor"]))
      }${get(c, "step", "what") ? ` · ${cut(str(get(c, "step", "what")), 60)}` : ""}`
    )
    : ["no claims"]
  if (claims.length > 8) out.push(`[${claims.length - 8} more claims: ${cut(claims.slice(8).map((c) => str(c["branch"])).join(", "), 200)}]`)
  const contested = arr(get(cl, "contested"))
  if (contested.length) {
    out.push(`contested: ${cut(contested.map((x) => (typeof x === "string" ? x : str(get(x, "ref") ?? get(x, "item")) || JSON.stringify(x))).join(", "), 300)}`)
  }
  const q = obj(get(s, "ready queue"))
  out.push(`queue: ${num(q["free"])} of ${num(q["maxWorkers"])} slots free, ${arr(q["waiting"]).length} waiting`)
  if (stale.length) out.push(`stale (${stale.length}): ${refList(stale.map((x) => `${str(x["branch"])} (${str(x["next"])})`), 4)}`)
  const risk = arr(get(s, "at-risk")).map(obj)
  if (risk.length) {
    out.push(`at risk: ${risk.map((x) => `${str(x["kind"])} ${str(x["name"])} ${num(x["count"])}${x["fix"] ? ` → ${str(x["fix"])}` : ""}`).join("; ")}`)
  }
  return bounded(out.join("\n"), "name one worker")
}

// metrics

async function metrics(r: Reader, a: O): Promise<string> {
  const name = textArg(a, "name")
  if (!name) {
    const ms = arr(get(await r.view("summary"), "metrics")).map(obj)
    if (!ms.length) return "no metrics recorded"
    return ms.map((x) => {
      if (str(x["value"]) === "") return `${str(x["metric"])}: no value${x["holds"] === false ? " · past its bound" : ""}`
      const was = str(x["was"]) && str(x["was"]) !== str(x["value"]) ? ` (was ${str(x["was"])}, ${str(x["change"])})` : ""
      return `${str(x["metric"])} ${str(x["value"])}${x["unit"] && x["unit"] !== x["metric"] ? ` ${str(x["unit"])}` : ""}${was} ${str(x["trend"])}${
        x["holds"] === false ? " · past its bound" : ""
      }`.trimEnd()
    }).join("\n")
  }
  const series = arr(get(await r.view("metrics"), "series")).map(obj)
  const s = series.find((x) => str(x["name"]) === name)
  if (!s) throw new Error(`no metric ${name}; the metrics: ${series.map((x) => str(x["name"])).join(", ")}`)
  const points = arr(s["points"]).map(obj)
  const n = limitOf(a, 12)
  return [
    `${name}: ${cut(str(s["says"]), 100)} (${str(s["unit"])}, ${str(s["better"])} is better), ${plural(points.length, "point")}`,
    ...points.slice(-n).map((p) => `  ${day(p["date"])} ${sha(p["commit"])} ${str(p["value"])}`),
  ].join("\n")
}
