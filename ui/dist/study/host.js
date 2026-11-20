// The host of a study's frame (develop/models-tab.md §6, §7). It runs in a sandbox of its own, with no connection
// anywhere, and talks only to the tab that framed it, by messages. Its address's fragment names its role and module:
//
//   #role=observer&src=<url>   loads the study's observer (init, on) and folds what the tab sends it
//   #role=view&src=<url>       loads the study's view (mount) and gives it the store's data; fire and can go back
//
// The tab's messages carry { naima: "study", t, ... }; this host answers in the same shape.

const params = new URLSearchParams(location.hash.slice(1))
const role = params.get("role")
const src = params.get("src")
const parentWin = window.parent
const post = (m) => parentWin.postMessage({ naima: "study", ...m }, "*")
const problem = (why) => {
  const el = document.getElementById("view")
  el.className = "problem"
  el.textContent = why
  post({ t: "error", why })
}

// ---- the explanations: the %@say lines, already parsed by the tab, matched here as the tab matches them

function terms(text) {
  // Splits a label's arguments at the top level: "f(a, g(b, c), [d, e])" -> ["a", "g(b, c)", "[d, e]"].
  const open = text.indexOf("(")
  if (open < 0) return { action: text.trim(), args: [] }
  const action = text.slice(0, open).trim()
  const body = text.slice(open + 1, text.lastIndexOf(")"))
  const args = []
  let depth = 0
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === "(" || c === "[" || c === "{") depth++
    else if (c === ")" || c === "]" || c === "}") depth--
    else if (c === "," && depth === 0) {
      args.push(body.slice(start, i).trim())
      start = i + 1
    }
  }
  if (body.trim() !== "") args.push(body.slice(start).trim())
  return { action, args }
}

function sayOf(says, label) {
  const { action, args } = terms(label)
  for (const s of says) {
    if (s.action !== action) continue
    if (s.args !== null && s.args.length !== args.length) continue
    const bound = {}
    let ok = true
    if (s.args !== null) {
      s.args.forEach((a, i) => {
        if (a.var !== undefined) bound[a.var] = args[i]
        else if (a.value !== args[i]) ok = false
      })
    }
    if (!ok) continue
    const fill = (t) => t.replace(/\{(\w+)\}/g, (m, v) => (v in bound ? bound[v] : m))
    return { phrase: fill(s.phrase), text: fill(s.text) }
  }
  return null
}

// ---- the observer

async function observer(mod) {
  if (typeof mod.init !== "function" || typeof mod.on !== "function") return problem("the observer module must export init and on")
  addEventListener("message", (e) => {
    if (e.source !== parentWin || e.data?.naima !== "study") return
    const m = e.data
    try {
      if (m.t === "init") post({ t: "memory", id: m.id, memory: mod.init(m.config, m.state) })
      else if (m.t === "fold") {
        let memory = m.memory
        const copies = []
        m.entries.forEach((entry, i) => {
          memory = mod.on(memory, entry)
          if (m.keep?.includes(i)) copies.push({ at: i, memory: structuredClone(memory) })
        })
        post({ t: "memory", id: m.id, memory, copies })
      }
    } catch (err) {
      post({ t: "error", id: m.id, why: String(err?.stack ?? err) })
    }
  })
  post({ t: "ready" })
}

// ---- the view

async function view(mod) {
  if (typeof mod.mount !== "function") return problem("the view module must export mount(target, host)")
  let data = null
  let says = []
  const listeners = new Set()
  const waiting = new Map()
  let next = 1
  const ask = (t, label) =>
    new Promise((resolve) => {
      const id = next++
      waiting.set(id, resolve)
      post({ t, id, label })
    })
  const host = {
    get data() {
      return data
    },
    subscribe(fn) {
      listeners.add(fn)
      if (data) fn(data)
      return () => listeners.delete(fn)
    },
    fire: (label) => ask("fire", label),
    can: (label) => ask("can", label),
    say: (label) => sayOf(says, label),
  }
  addEventListener("message", (e) => {
    if (e.source !== parentWin || e.data?.naima !== "study") return
    const m = e.data
    if (m.t === "tokens") {
      const root = document.documentElement
      for (const [k, v] of Object.entries(m.vars)) root.style.setProperty(k, v)
      root.dataset.theme = m.theme
    } else if (m.t === "says") says = m.says
    else if (m.t === "data") {
      data = m.data
      for (const fn of listeners) fn(data)
    } else if (m.t === "answer") {
      waiting.get(m.id)?.(m.result)
      waiting.delete(m.id)
    }
  })
  const target = document.getElementById("view")
  try {
    mod.mount(target, host)
  } catch (err) {
    return problem(String(err?.stack ?? err))
  }
  // The frame's height follows the view's, so the tab never scrolls inside it.
  new ResizeObserver(() => post({ t: "height", height: document.documentElement.scrollHeight })).observe(document.body)
  post({ t: "ready" })
}

if (!src || (role !== "observer" && role !== "view")) problem("this page is a study's frame: its address names a role and a module")
else {
  import(src).then((mod) => (role === "observer" ? observer(mod) : view(mod)), (err) => problem(`the module did not load: ${err}`))
}
