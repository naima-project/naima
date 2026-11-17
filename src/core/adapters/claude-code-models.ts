import type { ModelWindows } from "./index.ts"

// The models of Claude Code, with the context windows published for them: what the core asks the adapter for, so no
// model id is named outside the adapters (coordination/windows.ts).

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

/**
 * A model id as the table names it: from `claude-` on (a cloud's prefix such as `anthropic.` dropped), without a dated
 * snapshot (`-20251001`, `@20251001`) or a cloud's version suffix (`-v1:0`). A `[1m]` mark says the window outright.
 */
function key(model: string): string {
  const id = model.trim().toLowerCase()
  const at = id.indexOf("claude-")
  return (at >= 0 ? id.slice(at) : id).replace(/\[1m\]$/, "").replace(/@.*$/, "").replace(/-v\d+(:\d+)?$/, "").replace(/-\d{8}$/, "")
}

/** The window a `[1m]` mark on a model id says outright. */
const marked = (model: string): number | undefined => (/\[1m\]$/i.test(model.trim()) ? 1_000_000 : undefined)

/** Claude Code's models as an adapter declares them. */
export const claudeCodeModels: ModelWindows = { published: PUBLISHED, key, marked }
