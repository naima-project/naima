// Starting the supervisor so that it outlives the session that asked for the
// run. On POSIX, a detached child in a session of its own does. On Windows it
// does not when the session is an ssh one: the OpenSSH server puts every
// process of a session in a job object, closed with all of them when the
// session ends, and a detached child stays in the job. A process created
// through WMI (`Win32_Process.Create`) belongs to no such job, so on Windows
// the supervisor is started that way, through PowerShell, with the caller's
// environment and working directory.

import { Buffer } from "node:buffer"
import { windowsCommandLine } from "./remote.ts"

/** A program to run once, synchronously, with its arguments: what starts the supervisor on Windows. */
export interface Launch {
  program: string
  args: string[]
}

/** A PowerShell string literal: single-quoted, each single quote (and the typographic ones PowerShell also takes for one) doubled. */
export const psString = (text: string): string => `'${text.replace(/['‘’‚‛]/g, "$&$&")}'`

/**
 * The PowerShell script that creates `program args` through WMI, in `cwd`,
 * hidden, with the environment PowerShell itself was given, and prints the new
 * process id, or fails with the code `Win32_Process.Create` returned.
 */
export function windowsLaunchScript(program: string, args: string[], cwd: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$e = [Environment]::GetEnvironmentVariables('Process')",
    "$v = [string[]]@($e.Keys | Where-Object { $_ -and -not $_.StartsWith('=') } | ForEach-Object { \"$_=$($e[$_])\" })",
    "$si = New-CimInstance -CimClass (Get-CimClass -ClassName Win32_ProcessStartup) -ClientOnly -Property @{ ShowWindow = [uint16]0; EnvironmentVariables = $v }",
    `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${
      psString(windowsCommandLine([program, ...args]))
    }; CurrentDirectory = ${psString(cwd)}; ProcessStartupInformation = $si }`,
    'if ($r.ReturnValue -ne 0) { [Console]::Error.WriteLine("Win32_Process.Create returned $($r.ReturnValue)"); exit 1 }',
    "[Console]::Out.WriteLine($r.ProcessId)",
  ].join("\n")
}

/** How Windows starts `program args` outside the caller's job: PowerShell, given the script encoded, so that no quoting stands between them. */
export function windowsLaunch(program: string, args: string[], cwd: string): Launch {
  const encoded = Buffer.from(windowsLaunchScript(program, args, cwd), "utf16le").toString("base64")
  return { program: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded] }
}
