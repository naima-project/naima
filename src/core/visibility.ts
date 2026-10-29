// Whether a project looks public: what `naima init` decides where the tracker lives from.
//
// From the code repository's `origin`: none, or a path on this disk, is
// private; a GitHub repository is asked of GitHub's public API without
// credentials — 404 is private (or not there, which is no more public), a 200
// is what the answer's `private` field says, since a proxy that signs the
// request sees the owner's private repositories too —; anything else, or no
// answer, is unknown, which init treats as public: it asks before it commits
// a tracker where anyone could read it.

import { gitOrNull } from "./git.ts"

export type Visibility = "none" | "private" | "public" | "unknown"

/** The host the probe asks: what the launcher lets init reach. */
export const VISIBILITY_HOST = "api.github.com"

/** `owner/repo` of a GitHub remote URL, https or ssh; null for any other. */
export function githubRepo(url: string): string | null {
  const m = url.trim().match(/^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/)
  return m ? `${m[1]}/${m[2]}` : null
}

/** Whether a remote URL names a repository on this disk: a path, or file://. */
export const isLocalRemote = (url: string): boolean => /^(file:\/\/|\/|\.{1,2}\/|[A-Za-z]:[\\/])/.test(url.trim())

/** How a URL's visibility is asked: GitHub's public API, one request, five seconds at most. */
export async function probeVisibility(url: string): Promise<Visibility> {
  const repo = githubRepo(url)
  if (!repo) return "unknown"
  try {
    const r = await fetch(`https://${VISIBILITY_HOST}/repos/${repo}`, {
      headers: { "user-agent": "naima-init", accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(5000),
    })
    if (r.status !== 200) {
      await r.body?.cancel()
      return visibilityOfAnswer(r.status, null)
    }
    return visibilityOfAnswer(200, await r.json().catch(() => null))
  } catch {
    return "unknown"
  }
}

/**
 * What GitHub's answer about a repository says of its visibility. A 200 is not proof of public: a proxy
 * that signs the request (a cloud sandbox, a company gateway) is shown the owner's private repositories
 * too, so the answer's own `private` and `visibility` fields decide.
 */
export function visibilityOfAnswer(status: number, body: unknown): Visibility {
  if (status === 404) return "private"
  if (status !== 200) return "unknown"
  const b = (body ?? {}) as { private?: unknown; visibility?: unknown }
  if (b.private === true || b.visibility === "private" || b.visibility === "internal") return "private"
  return b.private === false || b.visibility === "public" ? "public" : "unknown"
}

/** The visibility of the repository at `root`, from its origin; `probe` asks a URL (injected by tests). */
export async function remoteVisibility(
  root: string,
  probe: (url: string) => Promise<Visibility> = probeVisibility,
): Promise<{ visibility: Visibility; url: string | null }> {
  const url = gitOrNull(root, "remote", "get-url", "origin")
  if (!url) return { visibility: "none", url: null }
  if (isLocalRemote(url)) return { visibility: "private", url }
  return { visibility: await probe(url), url }
}
