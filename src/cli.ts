// The program's entry point. The launcher (naima.ts) runs it under Deno with
// the permissions docs/guide/install.md lists; run directly, it is the development
// build, which aligns nothing and moves nothing.

import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { firstParty } from "./builtins.ts"
import { runCli } from "./core/internal.ts"

/** The Naima that is running: the directory above src/. */
const programRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const data = process.env["NAIMA_DATA"]
// The launcher's mark is for this process alone: a command it starts, a test
// suite under naima run among them, is not launched.
const launched = process.env["NAIMA_LAUNCHED"] === "1"
delete process.env["NAIMA_LAUNCHED"]

process.exitCode = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  programRoot,
  ...(data ? { data } : {}),
  launched,
  debug: process.env["NAIMA_DEBUG"] === "1",
  firstParty,
})
