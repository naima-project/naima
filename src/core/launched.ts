// The launcher's own variables. The launcher hands the program NAIMA_LAUNCHED,
// the data it found and the private context, which are for the program alone:
// a command the program starts, a run's among them, gets the caller's
// environment without them (docs/guide/long-work.md).

/** The launcher's mark: the program was started by the launcher. */
export const LAUNCHED = "NAIMA_LAUNCHED"

/** The names, comma-separated, of the variables the launcher set that the caller's environment did not have. */
export const LAUNCHER_SET = "NAIMA_LAUNCHER_SET"

/** The variables of `set` that `caller` lacks, as the value of LAUNCHER_SET. */
export function launcherSet(set: Record<string, string>, caller: Record<string, string | undefined>): string {
  return Object.keys(set).filter((k) => caller[k] === undefined).join(",")
}

/** `env` without the launcher's own variables: what a command the program starts is handed. */
export function callerEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const own = new Set([LAUNCHED, LAUNCHER_SET, ...(env[LAUNCHER_SET] ?? "").split(",").filter(Boolean)])
  return Object.fromEntries(Object.entries(env).filter(([k]) => !own.has(k)))
}
