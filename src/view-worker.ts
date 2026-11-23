// A worker of the UI's view pool (plugins/ui/view-pool.ts): one thread that opens the project once and renders the
// views and the tabs it is asked for, so that a slow one holds no other request of the server. It is the entry point's, not a
// plugin's, because it loads every plugin the way the command line does.

import { parentPort, workerData } from "node:worker_threads"
import { firstParty } from "./builtins.ts"
import { askHostsInBackground, type Context, gitReadScope } from "./core/api.ts"
import { openProject } from "./core/project.ts"
import { tabsOf, viewsOf } from "./plugins/ui/index.ts"
import { allTabs } from "./plugins/ui/tabs.ts"

/** A view asked for by its name and parameters, or a tab by its name, subtab and query. */
type Ask =
  | { id: number; view: string; params: Record<string, string[]>; tab?: undefined }
  | { id: number; tab: string; params: { sub: string | null; query: Record<string, string[]> }; view?: undefined }

const { root, data, program } = workerData as { root: string; data: string; program: string }
let opened: Promise<Context> | null = null
const project = (): Promise<
  Context
> => (opened ??= openProject({ root, data, program }, { programRoot: program, firstParty }, { out: () => {}, err: () => {}, now: () => new Date() }))

askHostsInBackground()
// The project is opened as the worker starts (the pool may start it before any view is asked), not on the first ask.
void project().catch(() => {})

parentPort!.on("message", (ask: Ask) => {
  void (async () => {
    let ctx: Context
    try {
      ctx = await project()
    } catch (e) {
      // The project could not be opened here: the pool is of no use, and the server renders its views itself.
      parentPort!.postMessage({ id: ask.id, ok: false, down: true, error: e instanceof Error ? e.message : String(e) })
      return
    }
    try {
      if (ask.tab !== undefined) {
        // A tab is rendered as the server would render it, the views shown as tabs among them; its content is plain data.
        const tab = allTabs(tabsOf(ctx), viewsOf(ctx)).find((t) => t.name === ask.tab)
        if (!tab) throw new Error(`no tab ${ask.tab}`)
        ctx.reload()
        // One view or tab asks each git question once, as the server's own thread does for what it renders (gitReadScope).
        const content = await gitReadScope(() => tab.render(ask.params, ctx))
        parentPort!.postMessage({ id: ask.id, ok: true, data: JSON.parse(JSON.stringify(content ?? null)) })
        return
      }
      const view = viewsOf(ctx).find((v) => v.name === ask.view)
      if (!view) throw new Error(`no view ${ask.view}`)
      ctx.reload()
      const rendered = await gitReadScope(() => view.render(ask.params, ctx))
      parentPort!.postMessage({ id: ask.id, ok: true, data: JSON.parse(JSON.stringify(rendered.data ?? null)) })
    } catch (e) {
      parentPort!.postMessage({ id: ask.id, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })()
})
