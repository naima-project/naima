// Where the desktop app's program may be installed: what naima hello looks in to open the UI (at-start.ts), and what
// the launcher grants hello to read and start; and where `naima ui --install-desktop` builds and installs it, which the
// launcher grants it to write. Imports nothing of Naima: the launcher loads it before the program.

import { posix } from "node:path"

/** The MacOS folder of Naima.app in macOS's Applications folders, the user's too; none elsewhere. They are macOS paths, so POSIX ones whichever host asks. */
export function desktopAppDirs(env: Record<string, string | undefined>, os: string): string[] {
  if (os !== "darwin") return []
  return ["/Applications", posix.join(env["HOME"] ?? "", "Applications")].map((apps) => posix.join(apps, "Naima.app", "Contents", "MacOS"))
}

/** Where `naima ui --install-desktop` installs the app: the user's own Applications folder, which needs no administrator. */
export const installedApp = (env: Record<string, string | undefined>): string => posix.join(env["HOME"] ?? "", "Applications", "Naima.app")

/** Where it builds the app: Naima's folder in the user's caches, kept between builds so that the next one compiles only what changed. */
export const buildDir = (env: Record<string, string | undefined>): string => posix.join(env["HOME"] ?? "", "Library", "Caches", "naima", "desktop")
