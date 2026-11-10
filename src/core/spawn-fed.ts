// A synchronous spawn that cannot deadlock on its own input. spawnSync with `input` writes all of it before reading
// the child's output, so once both pass the pipe's 64 KB the two processes block each other for ever, and spawnSync's
// timeout does not fire: git cat-file --batch on a large tracker did exactly that. Deno's spawnSync cannot take a file
// as standard input, so a line-oriented batch input (git cat-file --batch, --batch-check, a --stdin list of names) is
// fed in chunks under the pipe's size, each run on its own, and the outputs are joined in order; any other input is
// small, or its output is (a commit message, an object written with hash-object), so it cannot fill both pipes.
import { spawnSync, type SpawnSyncOptions, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process"

/** The largest chunk of input written to one run: half a pipe, so the child's output can never block its writer. */
export const CHUNK = 32 * 1024

type Fed = { input?: string | Uint8Array }

/** Whether `args` read their input as independent lines, so it may be split between runs. */
function lineBatch(program: string, args: string[]): boolean {
  if (program !== "git") return false
  if (args.includes("hash-object") || args.includes("commit-tree")) return false
  return args.some((a) => a === "--batch" || a === "--batch-check" || a.startsWith("--batch=") || a.startsWith("--batch-check=") || a === "--stdin")
}

/** The input cut at line ends into pieces of at most CHUNK characters, a longer line on its own. */
export function chunks(input: string): string[] {
  const out: string[] = []
  let at = 0
  while (at < input.length) {
    let end = Math.min(at + CHUNK, input.length)
    if (end < input.length) {
      const nl = input.lastIndexOf("\n", end - 1)
      end = nl >= at ? nl + 1 : input.indexOf("\n", end) + 1 || input.length
    }
    out.push(input.slice(at, end))
    at = end
  }
  return out
}

/** spawnSync, with a large line-oriented batch input fed in chunks: the same result, and no deadlock whatever the sizes. */
export function spawnSyncFed(program: string, args: string[], options: SpawnSyncOptionsWithStringEncoding & Fed): SpawnSyncReturns<string>
export function spawnSyncFed(program: string, args: string[], options: SpawnSyncOptions & Fed): SpawnSyncReturns<Buffer>
export function spawnSyncFed(program: string, args: string[], options: SpawnSyncOptions & Fed): SpawnSyncReturns<string | Buffer> {
  const { input } = options
  if (typeof input !== "string" || input.length <= CHUNK || !lineBatch(program, args)) return spawnSync(program, args, options)
  let last: SpawnSyncReturns<string | Buffer> | undefined
  const outs: (string | Buffer)[] = []
  const errs: (string | Buffer)[] = []
  for (const piece of chunks(input)) {
    last = spawnSync(program, args, { ...options, input: piece })
    outs.push(last.stdout)
    errs.push(last.stderr)
    if (last.status !== 0 || last.error) break
  }
  const text = typeof outs[0] === "string"
  const join = (xs: (string | Buffer)[]) => text ? xs.map(String).join("") : Buffer.concat(xs.map((x) => Buffer.from(x as Buffer)))
  return { ...last!, stdout: join(outs), stderr: join(errs), output: [null, join(outs), join(errs)] }
}
