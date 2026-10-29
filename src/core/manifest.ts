// Reading a plugin's manifest: what it contributes to a point, whichever of
// the ways it says so: a list under the point's own key, a list under
// `contributes`, or a folder of files under `contributes`, read by the point.

import { isAbsolute } from "node:path"
import { fileURLToPath } from "node:url"
import type { ExtensionPoint, FolderContribution, Migration, Plugin } from "./types.ts"

/** The folder a contribution names, or null when it is a list. */
function folderOf(raw: unknown): FolderContribution | null {
  if (typeof raw === "string") return { folder: raw }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as FolderContribution
  return null
}

/** The absolute path of the folder `f` names, relative to `p`'s home; an error saying why it cannot be read. */
function folderPath(p: Plugin, id: string, f: FolderContribution): string {
  if (typeof f.folder !== "string" || !f.folder.trim() || isAbsolute(f.folder) || f.folder.split(/[\\/]/).includes("..")) {
    throw new Error(`plugin "${p.name}": contributes.${id} must be a list, or a folder inside the plugin such as "${id}/"`)
  }
  if (!p.home) {
    throw new Error(`plugin "${p.name}": contributes.${id} names the folder ${f.folder}, and the manifest has no home to read it from — home: import.meta.url`)
  }
  const dir = f.folder.endsWith("/") ? f.folder : `${f.folder}/`
  return fileURLToPath(new URL(dir, p.home))
}

/**
 * What `p` contributes to the point `id`: the top-level key of that name — the typed sugar — then `contributes[id]`. A
 * folder named there is read by `point`'s `fromFolder`; without the point, or with a point that reads no files, it is an error.
 */
export function contributionsOf(p: Plugin, id: string, point?: ExtensionPoint): readonly unknown[] {
  const top = (p as unknown as Record<string, unknown>)[id]
  const raw = p.contributes?.[id]
  const f = folderOf(raw)
  if (!f) return [...(Array.isArray(top) ? top : []), ...((raw as readonly unknown[] | undefined) ?? [])]
  if (!point?.fromFolder) throw new Error(`plugin "${p.name}": contributes.${id} names a folder, and the point ${id} reads no files — list them instead`)
  const dir = folderPath(p, id, f)
  let read: unknown[]
  try {
    read = point.fromFolder(dir, f.settings ?? {})
  } catch (e) {
    throw new Error(`plugin "${p.name}": ${(e as Error).message}`)
  }
  return [...(Array.isArray(top) ? top : []), ...read]
}

/** A plugin's own migrations, wherever its manifest declares them. */
export const migrationsOf = (p: Plugin): Migration[] => contributionsOf(p, "migrations") as Migration[]
