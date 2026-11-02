// The app's store: every machine of the UI, made once, outside any component, each with the port that
// carries out its outputs. The ports are the only place with side effects: here, reading the summary from
// the server that serves this page (the same origin, its token already in a cookie), and reading it again
// when the shell says the moment changed. Until the server answers for a commit (a later step), the data
// read is always the live one.
import { createStore } from "./lib/ui/store/store.svelte.ts";
import { Shell } from "./logic/generated/shell/shell.svelte.ts";
import { Summary } from "./logic/summary.svelte.ts";

export function makeStore() {
  const summary: Summary = new Summary({
    read: () => {
      fetch("/data/summary", { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`the server answered ${r.status}`))))
        .then((data: Record<string, unknown>) => summary.shown(data))
        .catch((e: unknown) => summary.failed(e instanceof Error ? e.message : String(e)));
    },
  });
  return createStore({
    shell: new Shell({}, { reload: () => summary.reload() }),
    summary,
  });
}

export type AppStore = ReturnType<typeof makeStore>;
