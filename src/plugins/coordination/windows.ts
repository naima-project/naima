// The context window of the model a session runs on, and where that number comes from. A fullness share is stated as a
// fact only when the window is: set by the project for that model, or published for the model id the transcript names.
// Otherwise the default is assumed, and every text that uses it says so.
//
// Where the window can be read. The turn-end hook's input names the session's transcript and nothing about the model; the
// transcript's assistant messages carry the model id the request ran on (the API's id, never a context variant), and their
// usage, which is the context size. The host's own window (the context panel of an app, the status line's payload) is not
// given to a hook. So the window is, in order: the project's option for that model id (contextWindows), the window
// published for that id (below), the project's one number for any other model (contextWindow), and else the default,
// assumed and said to be.

/** The window assumed when nothing names one: said as assumed wherever it is used. */
export const DEFAULT_WINDOW = 200_000

/**
 * The windows published for model ids, in tokens. Only ids whose window is one number are listed: an id offered with a
 * 200000-token window by default and a larger one as an option is not, since the transcript does not say which ran.
 */
const PUBLISHED: Readonly<Record<string, number>> = {
  "claude-fable-5": 1_000_000,
  "claude-fable-5-1": 1_000_000,
  "claude-fable-5-2": 1_000_000,
  "claude-mythos-5": 1_000_000,
  "claude-mythos-5-1": 1_000_000,
  "claude-mythos-5-2": 1_000_000,
  "claude-opus-5": 1_000_000,
  "claude-opus-5-5": 1_000_000,
  "claude-opus-4-8": 1_000_000,
  "claude-opus-4-7": 1_000_000,
  "claude-opus-4-6": 1_000_000,
  "claude-sonnet-5": 1_000_000,
  "claude-sonnet-5-5": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-haiku-5-5": 1_000_000,
  "claude-haiku-4-5": 200_000,
}

/** The model ids whose window is published here, for the turn-end script's limits. */
export const publishedModels = (): string[] => Object.keys(PUBLISHED)

/**
 * A model id as the table names it: from `claude-` on (a cloud's prefix such as `anthropic.` dropped), without a dated
 * snapshot (`-20251001`, `@20251001`) or a cloud's version suffix (`-v1:0`). A `[1m]` mark says the window outright.
 */
export function modelKey(model: string): string {
  const id = model.trim().toLowerCase()
  const at = id.indexOf("claude-")
  return (at >= 0 ? id.slice(at) : id).replace(/\[1m\]$/, "").replace(/@.*$/, "").replace(/-v\d+(:\d+)?$/, "").replace(/-\d{8}$/, "")
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
    if (/\[1m\]$/i.test(model.trim())) return { tokens: 1_000_000, source: "published", ...at }
    const published = PUBLISHED[modelKey(model)]
    if (published !== undefined) return { tokens: published, source: "published", ...at }
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
