// Where the desktop app's program may be installed: what naima hello looks in to open the UI (at-start.ts), and what
// the launcher grants hello to read and start. Imports nothing of Naima: the launcher loads it before the program.

import { posix } from "node:path"

/** The MacOS folder of Naima.app in macOS's Applications folders, the user's too; none elsewhere. They are macOS paths, so POSIX ones whichever host asks. */
export function desktopAppDirs(env: Record<string, string | undefined>, os: string): string[] {
  if (os !== "darwin") return []
  return ["/Applications", posix.join(env["HOME"] ?? "", "Applications")].map((apps) => posix.join(apps, "Naima.app", "Contents", "MacOS"))
}
