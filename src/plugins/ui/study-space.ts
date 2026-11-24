// How a default study is stepped (develop/models-default-study.md §2, §3): a naima-codegen project through its generated
// code, which runs only in a sandboxed frame of the tab, as JavaScript; a plain model on its state space, explored by
// `naima model-explore` under `naima run`, kept per model, bound and start in Naima's state folder outside the project.
// And the UI tab's declaration (develop/ui-tab.md §3.1): which of the project's models it lists, and its card's page.

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as nodeModule from "node:module"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { gitPath, projectFiles, stateDir } from "../../core/api.ts"
import type { Study } from "./studies.ts"

/** Naima's folder for the Models tab's derived files of the project: the explored spaces, the frames' code. */
export function studyCache(root: string, what: "spaces" | "code"): string {
  const dir = join(stateDir(root) ?? join(tmpdir(), "naima-study-" + createHash("sha256").update(resolve(root)).digest("hex").slice(0, 12)), "study", what)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** TypeScript with its types erased, by the runtime's own stripper: Node's and Deno's node:module, or Bun's transpiler. */
export function stripTypes(ts: string): string {
  const strip = (nodeModule as unknown as { stripTypeScriptTypes?: (code: string, o?: { mode: string }) => string }).stripTypeScriptTypes
  if (typeof strip === "function") return strip(ts, { mode: "strip" })
  const bun = (globalThis as unknown as { Bun?: { Transpiler: new (o: { loader: string }) => { transformSync(code: string): string } } }).Bun
  if (bun) return new bun.Transpiler({ loader: "ts" }).transformSync(ts)
  throw new Error("this runtime cannot erase TypeScript's types: run Naima on Deno, Node 22.13 or later, or Bun")
}

/** The folder the frames' code of the study `id` is served from. */
export const codeFolder = (root: string, id: string): string => join(studyCache(root, "code"), id)

/**
 * The study's generated module as JavaScript, written to its code folder when the TypeScript changed: the file's name
 * there, which the frame imports through the files route `study-code-<id>`. Null when it has no generated TypeScript.
 */
export function studyCode(root: string, study: Study): string | null {
  if (!study.typescript) return null
  const ts = readFileSync(join(root, dirname(study.file), study.typescript), "utf8")
  const hash = createHash("sha256").update(ts).digest("hex").slice(0, 16)
  const name = `${basename(study.typescript, ".ts")}-${hash}.js`
  const dir = codeFolder(root, study.id)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  if (!existsSync(file)) writeFileSync(file, stripTypes(ts))
  return name
}

/** The system a study's space is explored on, from the root, or null: its declared or derived system. */
export function spaceSystem(root: string, study: Study): string | null {
  return study.system ? gitPath(relative(root, resolve(root, dirname(study.file), study.system))) : null
}

/** Where an exploration of the system at this bound, from this state or from its init, is kept: by the system's text. */
export function spaceFile(root: string, system: string, bound: number, from: Record<string, string> | null): string {
  const text = readFileSync(join(root, system), "utf8")
  const key = createHash("sha256").update(JSON.stringify([text, bound, from])).digest("hex").slice(0, 24)
  return join(studyCache(root, "spaces"), `${key}.json`)
}

/** The UI tab's declaration in the stance's file (develop/ui-tab.md §3.1), its paths made relative to the project. */
export interface UiTabDeclaration {
  /** The folders of the app's naima-codegen projects, or the projects themselves. */
  models: string[]
  /** Where the app keeps the generated TypeScript. */
  generated: string | null
  /** The page that mounts the app for the card, and the command that builds it, run in the declaration's folder. */
  card: { page: string; build: string[] } | null
  /** The folder of the stance's file that declares the tab, relative to the project: where its paths start. */
  dir: string
  /** The app as one thing: its name (the project's folder name when none is declared) and the machine that routes between its screens (`shell` when none is declared). */
  app: { name: string | null; machine: string; parts: Record<string, { name: string; says: string }> }
}

/** The project's UI tab, or null when no stance-ui.json declares one. */
export function uiTab(root: string, program?: string): UiTabDeclaration | null {
  for (const file of projectFiles(root, program).filter((f) => basename(f) === "stance-ui.json")) {
    const d = declaration(root, file)
    if (d) return d
  }
  return null
}

function declaration(root: string, file: string): UiTabDeclaration | null {
  let tab: { models?: unknown; generated?: unknown; card?: { page?: unknown; build?: unknown }; app?: { name?: unknown; machine?: unknown; parts?: unknown } }
  try {
    tab = (JSON.parse(readFileSync(join(root, file), "utf8")) as { tab?: typeof tab }).tab ?? {}
  } catch {
    return null
  }
  if (!Array.isArray(tab.models) || !tab.models.length) return null
  const dir = dirname(file)
  const rel = (p: string): string | null => {
    const r = relative(root, resolve(root, dir, p))
    return r.startsWith("..") || isAbsolute(r) ? null : gitPath(r)
  }
  const models = tab.models.filter((m): m is string => typeof m === "string").map(rel).filter((m): m is string => m !== null)
  const page = typeof tab.card?.page === "string" ? rel(tab.card.page) : null
  const build = Array.isArray(tab.card?.build) ? tab.card.build.filter((w): w is string => typeof w === "string") : []
  return {
    models,
    generated: typeof tab.generated === "string" ? rel(tab.generated) : null,
    card: page ? { page, build } : null,
    dir: gitPath(dir),
    app: {
      name: typeof tab.app?.name === "string" && tab.app.name.trim() ? tab.app.name.trim() : null,
      machine: typeof tab.app?.machine === "string" && tab.app.machine.trim() ? tab.app.machine.trim() : "shell",
      parts: partsOf(tab.app?.parts),
    },
  }
}

/** The plain names the declaration gives the app's parts, by the folder of each part's machine; anything else in it is ignored. */
function partsOf(raw: unknown): Record<string, { name: string; says: string }> {
  const out: Record<string, { name: string; says: string }> = {}
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out
  for (const [machine, v] of Object.entries(raw)) {
    const p = v as { name?: unknown; says?: unknown } | null
    if (typeof p?.name === "string" && p.name.trim()) out[machine] = { name: p.name.trim(), says: typeof p.says === "string" ? p.says.trim() : "" }
  }
  return out
}

/** Whether a study is one of the UI tab's: a naima-codegen project under a folder the declaration names. */
export const inUiTab = (tab: UiTabDeclaration, study: Study): boolean =>
  study.kind === "codegen" && tab.models.some((m) => study.file === `${m}/codegen.toml` || study.file.startsWith(m + "/"))
