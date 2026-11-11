// A worker of the UI's view pool (plugins/ui/view-pool.ts): one thread that opens the project once and renders the
// views it is asked for, so that a slow view holds no other request of the server. It is the entry point's, not a
// plugin's, because it loads every plugin the way the command line does.

import { parentPort, workerData } from "node:worker_threads"
import { firstParty } from "./builtins.ts"
import { askHostsInBackground, type Context } from "./core/api.ts"
import { openProject } from "./core/project.ts"
import { viewsOf } from "./plugins/ui/index.ts"

interface Ask {
  id: number
  view: string
  params: Record<string, string[]>
}

const { root, data, program } = workerData as { root: string; data: string; program: string }
let opened: Promise<Context> | null = null
const project = (): Promise<
  Context
> => (opened ??= openProject({ root, data, program }, { programRoot: program, firstParty }, { out: () => {}, err: () => {}, now: () => new Date() }))

askHostsInBackground()

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
      const view = viewsOf(ctx).find((v) => v.name === ask.view)
      if (!view) throw new Error(`no view ${ask.view}`)
      ctx.reload()
      const rendered = await view.render(ask.params, ctx)
      parentPort!.postMessage({ id: ask.id, ok: true, data: JSON.parse(JSON.stringify(rendered.data ?? null)) })
    } catch (e) {
      parentPort!.postMessage({ id: ask.id, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })()
})
