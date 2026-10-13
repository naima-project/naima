// The claims and the session notes as views of `naima ui`: the shape the
// `ui-views` point takes, declared here since plugins never import each other.
// Each view's data is what its command prints with --json; an item links to
// the window's item view, where its evidence is.

import { type Context, positiveInt } from "../../core/api.ts"
import type { ClaimsData, Pass } from "./index.ts"

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** An item's reference, linked to the window's item view. */
const itemLink = (id: string, ref: string): string => `<a href="/view/item?item=${encodeURIComponent(id)}"><code>${esc(ref)}</code></a>`

/** Who holds what, across branches: a panel of the first screen. */
export function claimsUiView(claimsData: (ctx: Context) => ClaimsData) {
  return {
    name: "claims",
    title: "Claims",
    says: "who holds what, recombined from every branch, and the items more than one branch holds; its data is `naima claims --json`",
    order: 20,
    panel: true,
    render(_params: Record<string, string[]>, ctx: Context) {
      const d = claimsData(ctx)
      const held = d.claims.filter((c) => c.items.length || c.preparing)
      const branch = (c: ClaimsData["claims"][number]) =>
        [
          `<h3><code>${esc(c.branch)}</code>${c.here ? ' <span class="tag">(here)</span>' : ""}${
            c.preparing ? ' <span class="tag">(being prepared)</span>' : ""
          }</h3>`,
          ...(c.note ? [`<p>${esc(c.note)}</p>`] : []),
          c.items.length ? `<ul>${c.items.map((e) => `<li>${itemLink(e.id, e.ref)} ${esc(e.title)}</li>`).join("")}</ul>` : "<p>No items.</p>",
        ].join("\n")
      const contested = d.contested.length
        ? `<h3>Held by more than one branch (allowed)</h3><ul>${
          d.contested.map((c) => `<li>${itemLink(c.id, c.ref)} → ${c.branches.map((b) => `<code>${esc(b)}</code>`).join(", ")}</li>`).join("")
        }</ul>`
        : ""
      return {
        data: d,
        html: held.length ? [...held.map(branch), contested].join("\n") : "<p>No branch claims an item.</p>",
        css: ".tag{font-weight:400;opacity:.75}h3{margin:12px 0 4px;font-size:1em}",
      }
    },
  }
}

/** The session notes, across branches, newest first: a tab; `?n=` says how many (5). */
export function notesUiView(readPasses: (ctx: Context) => Pass[]) {
  return {
    name: "notes",
    title: "Session notes",
    says: "the newest session notes, across every branch, newest first; `?n=` says how many (5); its data is `naima pass --list [n] --json`",
    order: 11,
    render(params: Record<string, string[]>, ctx: Context) {
      const n = positiveInt(params["n"]?.[0], 5, "notes")
      const passes = readPasses(ctx).slice(0, n)
      const form = `<form class="pick" method="get" action="/view/notes"><label for="notes-n">How many</label> ` +
        `<input id="notes-n" name="n" type="number" min="1" value="${n}"> <button type="submit">Show</button></form>`
      const note = (p: Pass) =>
        `<article><h2>${esc(p.date)} — <code>${esc(p.branch)}</code>${p.local ? ' <span class="tag">(working tree)</span>' : ""}</h2>\n<pre>${
          esc(p.body)
        }</pre></article>`
      return {
        data: passes,
        html: ["<h1>Session notes</h1>", form, ...(passes.length ? passes.map(note) : ["<p>No session notes.</p>"])].join("\n"),
        css: "article{margin:0 0 16px}article h2{font-size:1em;margin:0 0 4px}pre{white-space:pre-wrap;margin:0}.tag{font-weight:400;opacity:.75}",
      }
    },
  }
}
