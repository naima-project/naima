// The context window of the model a session runs on, and where that number comes from. A share of the window is stated
// as a fact only when the window is: set by the project for that model, or published for the model id the transcript
// names. Otherwise the window is assumed, and every text that uses it says so.
//
// Where the window can be read. The turn-end hook's input names the session's transcript and nothing about the model; the
// transcript's assistant messages carry the model id the request ran on (the API's id, never a context variant), and their
// usage, which is the context size. The host's own window (the context panel of an app, the status line's payload) is not
// given to a hook. So the window is, in order: the project's option for that model id (contextWindows), the window
// published for that id (below), the project's one number for any other model (contextWindow), and else the default,
// assumed and said to be.

import { ADAPTERS } from "../../core/adapters/index.ts"

/** The window assumed when nothing names one, the owner's choice: the window of the current models, said as assumed wherever it is used. */
export const DEFAULT_WINDOW = 1_000_000

/**
 * The windows published for model ids come from the adapters (core/adapters): each declares the ids of its host's models
 * whose window is one number, how an id is normalized to the key the table names, and a mark in an id that says the window.
 */
const published = (): Record<string, number> => Object.assign({}, ...ADAPTERS.map((a) => a.models?.published ?? {}))

/** The model ids whose window is published, for the turn-end script's limits. */
export const publishedModels = (): string[] => Object.keys(published())

/** A model id as the adapters' tables name it: each adapter that knows models normalizes it in turn, else lowercased. */
export function modelKey(model: string): string {
  return ADAPTERS.reduce((id, a) => a.models?.key(id) ?? id, model.trim().toLowerCase())
}

/** Where a window came from: set by the project, published for the model, or the default assumed. */
export type WindowSource = "set" | "published" | "assumed"

export interface Window {
  tokens: number
  source: WindowSource
  /** The model id the transcript names, when it names one. */
  model?: string
}

export interface WindowOptions {
  /** The project's windows by model id, set by the owner. */
  contextWindows: Readonly<Record<string, number>>
  /** The project's window for any model neither named there nor published here, set by the owner; absent when unset. */
  contextWindow?: number
}

/** The window of `model` under the project's options, and where it came from. */
export function windowOf(model: string | undefined, o: WindowOptions): Window {
  const at = model ? { model } : {}
  if (model) {
    const set = o.contextWindows[model] ?? o.contextWindows[modelKey(model)]
    if (set !== undefined) return { tokens: set, source: "set", ...at }
    const said = ADAPTERS.map((a) => a.models?.marked?.(model)).find((n) => n !== undefined)
    if (said !== undefined) return { tokens: said, source: "published", ...at }
    const table = published()[modelKey(model)]
    if (table !== undefined) return { tokens: table, source: "published", ...at }
  }
  if (o.contextWindow !== undefined) return { tokens: o.contextWindow, source: "set", ...at }
  return { tokens: DEFAULT_WINDOW, source: "assumed", ...at }
}

/** The windows option, validated: an object of positive whole numbers by model id. */
export function readWindows(v: unknown): Record<string, number> {
  if (v === undefined) return {}
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new Error(`coordination: options.contextWindows is an object of windows in tokens by model id, got ${JSON.stringify(v)}`)
  }
  const out: Record<string, number> = {}
  for (const [model, n] of Object.entries(v)) {
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
      throw new Error(`coordination: options.contextWindows.${model} is not a positive whole number of tokens, got ${JSON.stringify(n)}`)
    }
    out[model] = n
  }
  return out
}
