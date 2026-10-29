// A remote for every repository Naima relies on: the tracker's own repository
// when it is kept private beside the code, and the project's repository. One
// with no remote lives on one machine and is lost with it, so the owner is
// asked once, through the agent, whether to create a private GitHub repository
// for it; they may keep working locally instead, and that answer is recorded in
// the repository's own git config. On a yes, Naima uses gh, GitHub's
// command-line tool, which it installs into its own tools folder when it is
// missing (a tool declaration, installed by the tools plugin with the owner's
// consent), then signs in through gh's browser flow and creates the repository.
//
// The states, per repository: not asked; asked (no answer yet); declined; and
// backed up, which is a remote being there, whoever added it. Only `asked` and
// `declined` are recorded; a remote clears the record.

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { basename, delimiter, join } from "node:path"
import {
  bool,
  type Command,
  type Context,
  CONTRACT,
  EXIT,
  gitOrNull,
  installDirOf,
  NaimaError,
  parse,
  platformKey,
  type Plugin,
  posixRelative,
  programFile,
  RECEIPT,
  rendered,
  runGit,
  type Setup,
  str,
  type SummarySection,
  toolsDir,
  usageError,
} from "../../core/api.ts"

/** The git config key, in the repository concerned, that records the owner's answer: `asked` or `declined`. */
export const ANSWER_KEY = "naima.backup"

/** GitHub refuses a file larger than this in a repository (its per-file limit). */
export const GITHUB_FILE_LIMIT = 100 * 1024 * 1024

/** Where the owner creates an empty repository by hand, when gh cannot sign in with a browser. */
export const NEW_REPOSITORY = "https://github.com/new"

const GH_RELEASE = "https://github.com/cli/cli/releases/download/v2.103.3"

/**
 * gh 2.103.3, the release archive for each platform. Sizes from the release, sha256 from its checksums file
 * (gh_2.103.3_checksums.txt). The tools point belongs to the tools plugin, and plugins never import each other: the
 * shape is the one its contract declares.
 */
export const GH = {
  name: "gh",
  title: "GitHub CLI",
  says: "GitHub's command-line tool: Naima uses it to create a private repository on GitHub and push to it, after the owner's yes",
  version: "2.103.3",
  licence: "MIT",
  homepage: "https://cli.github.com",
  source: "https://github.com/cli/cli",
  authors: ["GitHub"],
  programs: ["gh"],
  verify: { program: "gh", args: ["--version"], expect: "gh version 2.103.3" },
  platforms: {
    "darwin-arm64": {
      url: `${GH_RELEASE}/gh_2.103.3_macOS_arm64.zip`,
      size: 14106091,
      sha256: "d700207eae9ae98fe2b89535c2c087c07823d4628c56364695a5a07ef311c062",
      format: "zip",
      bin: "gh_2.103.3_macOS_arm64/bin",
    },
    "darwin-x64": {
      url: `${GH_RELEASE}/gh_2.103.3_macOS_amd64.zip`,
      size: 15702601,
      sha256: "a2f86418f4350ae6e9ec60d5000bdf7665728436946a97fc27fe50e6ae752682",
      format: "zip",
      bin: "gh_2.103.3_macOS_amd64/bin",
    },
    "linux-x64": {
      url: `${GH_RELEASE}/gh_2.103.3_linux_amd64.tar.gz`,
      size: 15031972,
      sha256: "4c806978ffce1cec70853302a56d70ac6da4f19bae7adca4e1a8ab00633dd91d",
      format: "tar.gz",
      bin: "gh_2.103.3_linux_amd64/bin",
    },
    "linux-arm64": {
      url: `${GH_RELEASE}/gh_2.103.3_linux_arm64.tar.gz`,
      size: 13661485,
      sha256: "ee32df2323c8847f5fac6cb6b4b69ca75828e9329a8f22f677021f7b3306ce63",
      format: "tar.gz",
      bin: "gh_2.103.3_linux_arm64/bin",
    },
    "windows-x64": {
      url: `${GH_RELEASE}/gh_2.103.3_windows_amd64.zip`,
      size: 15197187,
      sha256: "98d0cfa794721665d7973dd728c78aff7bd836d58f10f6d7a03568eccb0a22e0",
      format: "zip",
      bin: "bin",
    },
  },
}

/** The part of a tool declaration this plugin reads to find an installed gh. */
export type GhDeclaration = { name: string; version: string; platforms: Record<string, { bin: string } | { unavailable: string }> }

/** What one program run gave. */
export interface Ran {
  status: number | null
  stdout: string
  stderr: string
}

/** The machine the plugin runs gh on: its environment and platform, and how a program is started. */
export interface BackupWorld {
  env: Record<string, string | undefined>
  os: string
  arch: string
  /** Run a program; `inherit` gives it the terminal, for gh's sign-in, which talks to the person. */
  run(program: string, args: string[], options: { cwd: string; inherit?: boolean }): Ran
}

export const realWorld = (): BackupWorld => ({
  env: process.env,
  os: process.platform,
  arch: process.arch,
  run(program, args, { cwd, inherit }) {
    try {
      const r = spawnSync(program, args, {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
      })
      return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? r.error.message : "") }
    } catch (e) {
      return { status: null, stdout: "", stderr: e instanceof Error ? e.message : String(e) }
    }
  },
})

/** A repository Naima relies on, as the plugin speaks of it. */
export interface Subject {
  /** `tracker`: the tracker's own repository, in sibling mode; `project`: the project's repository, which holds the tracker otherwise. */
  kind: "tracker" | "project"
  dir: string
  /** How it is named to the owner. */
  name: string
}

/** The repositories Naima relies on: the project's, and the tracker's when it is a repository of its own. */
export function subjects(ctx: Context): Subject[] {
  const project: Subject = { kind: "project", dir: ctx.root, name: "the project's repository" }
  if (ctx.trackerGit === ctx.root) return [project]
  return [{ kind: "tracker", dir: ctx.trackerGit, name: `the tracker's repository (${posixRelative(ctx.root, ctx.trackerGit)}/)` }, project]
}

/** Its first remote's address, credentials removed; null when it has none. */
export function remoteOf(dir: string): string | null {
  const names = (gitOrNull(dir, "remote") ?? "").split("\n").map((s) => s.trim()).filter(Boolean)
  const name = names.includes("origin") ? "origin" : names[0]
  if (!name) return null
  const url = gitOrNull(dir, "remote", "get-url", name) ?? name
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]+@/i, "$1")
}

/** The owner's recorded answer for a repository: asked, declined, or none. */
export function answerOf(dir: string): "asked" | "declined" | null {
  const v = gitOrNull(dir, "config", "--local", "--get", ANSWER_KEY)
  return v === "asked" || v === "declined" ? v : null
}

const record = (dir: string, value: "asked" | "declined"): void => {
  const r = runGit(dir, ["config", "--local", ANSWER_KEY, value])
  if (!r.ok) throw new NaimaError(`cannot record the answer in ${dir}'s git config: ${r.err || "git failed"}`)
}

const forget = (dir: string): void => void runGit(dir, ["config", "--local", "--unset", ANSWER_KEY])

/** The question put to the owner, through the agent, for a repository with no remote. */
export function question(s: Subject): string {
  const flag = `--repo ${s.kind}`
  const size = s.kind === "project"
    ? ` GitHub takes no file over ${GITHUB_FILE_LIMIT / 1024 / 1024} MB (its per-file limit): keep larger files out of the repository, or it cannot go there.` +
      ` By hand, it is an empty private repository made at ${NEW_REPOSITORY}, then naima backup add <its address> ${flag}.`
    : ""
  return `Ask the owner once: ${s.name} has no remote, so it lives on this machine only and is lost with it. ` +
    `Create a private GitHub repository for it and push to it? Naima does it with gh, GitHub's command-line tool, installed in Naima's own tools folder if it is missing.${size} ` +
    `Yes: naima backup create ${flag} --consent "<their yes, restated>" --by <who>; ` +
    `no, they keep working locally: naima backup decline ${flag} (recorded, and naima hello reminds them).`
}

/** What naima hello says of a repository the owner left without a remote: one line. */
export function reminder(s: Subject): string {
  return `${s.name.charAt(0).toUpperCase()}${
    s.name.slice(1)
  } is not backed up by a remote: it lives on this machine only. You can ask the agent to set up a private one (naima backup create --repo ${s.kind}).`
}

/** Files of HEAD larger than GitHub takes: their paths and sizes. */
export function tooLarge(dir: string): { path: string; size: number }[] {
  const listed = runGit(dir, ["ls-tree", "-r", "-l", "-z", "HEAD"])
  if (!listed.ok) return []
  const out: { path: string; size: number }[] = []
  for (const entry of listed.out.split("\0")) {
    const m = entry.match(/^\d+ blob [0-9a-f]+\s+(\d+)\t(.*)$/s)
    if (m && Number(m[1]) > GITHUB_FILE_LIMIT) out.push({ path: m[2]!, size: Number(m[1]) })
  }
  return out
}

/** The gh to run: on PATH, else the one Naima installed in its tools folder; null when neither is there. */
export function findGh(world: BackupWorld, gh: GhDeclaration): string | null {
  const file = programFile("gh", world.os)
  for (const d of (world.env["PATH"] ?? "").split(delimiter)) {
    if (d && existsSync(join(d, file))) return join(d, file)
  }
  const dir = toolsDir(world.env, world.os)
  const source = gh.platforms[platformKey(world.os, world.arch)]
  if (!dir || !source || "unavailable" in source) return null
  const root = installDirOf(dir, gh)
  const path = join(root, source.bin, file)
  return existsSync(join(root, RECEIPT)) && existsSync(path) ? path : null
}

function subjectOf(ctx: Context, repo: string | undefined): Subject {
  const all = subjects(ctx)
  if (repo === undefined) return all[0]!
  if (repo !== "tracker" && repo !== "project") throw new NaimaError(`--repo is tracker or project, not ${repo}`, "usage")
  // Kept with the code, the tracker's repository is the project's.
  return all.find((s) => s.kind === repo) ?? all[0]!
}

/** Push the current branch to origin, setting it upstream; nothing when nothing is committed yet. */
function pushFirst(dir: string): string {
  if (!gitOrNull(dir, "rev-parse", "--verify", "--quiet", "HEAD")) return "nothing is committed yet: the first commit is pushed with git push -u origin HEAD"
  const r = runGit(dir, ["push", "--quiet", "-u", "origin", "HEAD"])
  if (!r.ok) {
    throw new NaimaError(
      `the remote is set, but the push failed: ${r.err.split("\n").find((l) => l.trim()) ?? "git failed"} — fix it, then git push -u origin HEAD`,
    )
  }
  return `pushed ${gitOrNull(dir, "rev-parse", "--abbrev-ref", "HEAD") ?? "HEAD"}`
}

const noBrowser = (s: Subject): string =>
  `Without a browser, the owner makes the repository by hand: an empty private repository at ${NEW_REPOSITORY} (no README, licence or .gitignore), ` +
  `then gives its address to the agent, which runs naima backup add <its address> --repo ${s.kind}.`

async function create(ctx: Context, world: BackupWorld, gh: GhDeclaration, args: string[]): Promise<number> {
  const p = parse(args, {
    repo: { type: "string" },
    name: { type: "string" },
    consent: { type: "string" },
    by: { type: "string" },
    "no-browser": { type: "boolean" },
  })
  const s = subjectOf(ctx, str(p, "repo"))
  const remote = remoteOf(s.dir)
  if (remote) {
    forget(s.dir)
    ctx.out(`${s.name} already has a remote, ${remote}: nothing to create`)
    return EXIT.OK
  }
  const large = tooLarge(s.dir)
  if (large.length) {
    throw new NaimaError(
      `GitHub takes no file over ${GITHUB_FILE_LIMIT / 1024 / 1024} MB, and ${s.name} holds ${
        large.map((f) => `${f.path} (${Math.round(f.size / 1024 / 1024)} MB)`).join(", ")
      } — take them out of the repository first; nothing created`,
    )
  }
  if (bool(p, "no-browser")) {
    ctx.out(noBrowser(s))
    return EXIT.OK
  }
  let program = findGh(world, gh)
  if (!program) {
    const words = str(p, "consent")
    const by = str(p, "by")
    if (!words || !by) {
      throw new NaimaError(
        `gh, GitHub's command-line tool, is not installed: Naima installs it in its own tools folder, without administrator rights, from GitHub's release archive, its checksum verified. ` +
          `Run again with the owner's yes: naima backup create --repo ${s.kind} --consent "<their yes, restated>" --by <who>`,
      )
    }
    const tools = ctx.registry.commands.get("tools")
    if (!tools) {
      throw new NaimaError(
        `gh is not installed, and the tools plugin, which installs it, is off: install gh from https://cli.github.com, or switch the tools plugin on`,
      )
    }
    const code = await tools.run(["install", gh.name, "--consent", words, "--by", by], ctx)
    if (code !== EXIT.OK) return code
    program = findGh(world, gh)
    if (!program) throw new NaimaError(`gh was installed, but is not where Naima looks for it: naima tools path gh says where it is`)
  }
  if (world.run(program, ["auth", "status", "--hostname", "github.com"], { cwd: s.dir }).status !== 0) {
    ctx.out(
      `Signing in to GitHub with gh. gh shows a one-time code: copy it, and paste it into the GitHub page that opens in the browser (https://github.com/login/device, if none opens).`,
    )
    const login = world.run(program, ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web"], { cwd: s.dir, inherit: true })
    if (login.status !== 0) {
      ctx.out(`gh could not sign in.`)
      ctx.out(noBrowser(s))
      return EXIT.FAILED
    }
  }
  const name = str(p, "name") ?? (s.kind === "tracker" ? `${basename(ctx.root)}-tracker` : basename(ctx.root))
  const committed = !!gitOrNull(s.dir, "rev-parse", "--verify", "--quiet", "HEAD")
  const made = world.run(program, ["repo", "create", name, "--private", "--source", s.dir, "--remote", "origin", ...(committed ? ["--push"] : [])], {
    cwd: s.dir,
  })
  if (made.status !== 0) {
    throw new NaimaError(
      `gh could not create the repository ${name}: ${
        (made.stderr || made.stdout).trim().split("\n").slice(-2).join(" ") || `exit ${made.status}`
      } — another name: --name <name>. ${noBrowser(s)}`,
    )
  }
  const now = remoteOf(s.dir)
  if (!now) throw new NaimaError(`gh said it created ${name}, but ${s.name} has no remote: ${noBrowser(s)}`)
  forget(s.dir)
  ctx.out(
    `created the private repository ${now} for ${s.name}${
      committed ? ", and pushed to it" : "; nothing is committed yet: the first commit is pushed with git push -u origin HEAD"
    }`,
  )
  return EXIT.OK
}

function add(ctx: Context, args: string[]): number {
  const p = parse(args, { repo: { type: "string" } })
  const url = p.positionals[0]
  if (!url || p.positionals.length > 1) throw new NaimaError("usage: naima backup add <address> [--repo tracker|project]", "usage")
  const s = subjectOf(ctx, str(p, "repo"))
  const remote = remoteOf(s.dir)
  if (remote) throw new NaimaError(`${s.name} already has a remote, ${remote}: nothing added`)
  const r = runGit(s.dir, ["remote", "add", "origin", url])
  if (!r.ok) throw new NaimaError(`cannot add the remote: ${r.err || "git failed"}`)
  forget(s.dir)
  ctx.out(`added ${remoteOf(s.dir)} as the remote of ${s.name}; ${pushFirst(s.dir)}`)
  return EXIT.OK
}

function decline(ctx: Context, args: string[]): number {
  const p = parse(args, { repo: { type: "string" } })
  const s = subjectOf(ctx, str(p, "repo"))
  const remote = remoteOf(s.dir)
  if (remote) {
    ctx.out(`${s.name} already has a remote, ${remote}: nothing to record`)
    return EXIT.OK
  }
  record(s.dir, "declined")
  ctx.out(
    `recorded in ${s.name}'s git config (${ANSWER_KEY}): it stays on this machine only; naima hello says so at each session, and naima backup create --repo ${s.kind} sets up a remote later`,
  )
  return EXIT.OK
}

function status(ctx: Context): number {
  for (const s of subjects(ctx)) {
    const remote = remoteOf(s.dir)
    const answer = answerOf(s.dir)
    ctx.out(
      `${s.name}: ${
        remote
          ? `backed up by ${remote}`
          : answer === "declined"
          ? "no remote — the owner chose to keep it on this machine"
          : answer === "asked"
          ? "no remote — asked, not answered yet"
          : "no remote — not asked yet"
      }`,
    )
  }
  return EXIT.OK
}

/** The repositories the owner chose to keep without a remote: what naima hello reminds of. */
const unbacked = (ctx: Context): Subject[] => subjects(ctx).filter((s) => answerOf(s.dir) === "declined" && !remoteOf(s.dir))

export function backupPlugin(world: () => BackupWorld = realWorld, gh: GhDeclaration = GH): Plugin {
  const command: Command = {
    name: "backup",
    says:
      "the remote of each repository Naima relies on — the tracker's own, kept private beside the code, and the project's: say which have one; create a private GitHub repository with gh, after the owner's yes; add one the owner made by hand; record that the owner keeps one on this machine",
    usage:
      'backup [create [--repo tracker|project] [--name <name>] [--consent "<yes>" --by <who>] [--no-browser] | add <address> [--repo tracker|project] | decline [--repo tracker|project]]',
    options: [
      {
        name: "--repo",
        says: "which repository: tracker (its own repository, kept private beside the code) or project; the one holding the tracker by default",
      },
      { name: "--name", says: "create: the name of the repository on GitHub; the project folder's name by default, with -tracker for the tracker's" },
      { name: "--consent", says: "create: the owner's yes, restated, recorded with gh when Naima installs it" },
      { name: "--by", says: "create: who said yes" },
      { name: "--no-browser", says: "create: say how to make the repository by hand at github.com/new and add it, instead of signing in through a browser" },
    ],
    examples: [
      "backup",
      'backup create --repo tracker --consent "yes, make it private on GitHub" --by owner',
      "backup add https://github.com/<owner>/<project>-tracker.git --repo tracker",
      "backup decline --repo tracker",
    ],
    enforces:
      "a repository Naima relies on is never left without a remote unless the owner said so: the owner is asked once, at init or at the next update, and a no is recorded and recalled by naima hello",
    long: {
      cannot: "gh's sign-in and its repository creation have no progress interface",
      instead: "the install of gh reports its download through naima tools; gh's own lines are shown as it prints them",
    },
    run(args, ctx) {
      const [sub, ...rest] = args
      if (sub === undefined) return status(ctx)
      if (sub === "create") return create(ctx, world(), gh, rest)
      if (sub === "add") return add(ctx, rest)
      if (sub === "decline") return decline(ctx, rest)
      throw usageError(command)
    },
  }
  const ask: Setup = {
    name: "backup-question",
    says: "for each repository Naima relies on that has no remote and was never asked about: the question to put to the owner, once, recorded as asked",
    install(ctx) {
      const out: string[] = []
      for (const s of subjects(ctx)) {
        if (remoteOf(s.dir) || answerOf(s.dir) !== null) continue
        record(s.dir, "asked")
        out.push(question(s))
      }
      return out
    },
  }
  const section: SummarySection = {
    name: "backup",
    render: (ctx) => rendered(unbacked(ctx), (list) => list.map(reminder)),
    offers: (ctx) => rendered(unbacked(ctx), (list) => list.map(reminder)),
  }
  return {
    name: "backup",
    contract: CONTRACT,
    says: "a remote for every repository Naima relies on: the owner is asked once whether to create a private GitHub repository for one that has none",
    about:
      "A repository with no remote lives on one machine and is lost with it. The repositories Naima relies on are the project's and, when the tracker is kept private beside the code, the tracker's own. " +
      "For each one with no remote, `naima init`, or the next `naima update` of an existing installation, says the question to ask the owner, once: whether to create a private GitHub repository for it, or keep working locally. " +
      "On a yes, `naima backup create` uses gh, GitHub's command-line tool: when it is missing, Naima installs it into its own tools folder with the owner's consent, from GitHub's release archive, its checksum verified, without administrator rights; then gh signs in through the browser, showing a one-time code to copy and paste, and creates the private repository and pushes to it. " +
      "Without a browser, the owner makes an empty private repository at github.com/new and `naima backup add <its address>` adds it and pushes. " +
      "A no is recorded in that repository's git config (`naima.backup`), and every later `naima hello` says in one line that it is not backed up by a remote. For the project's repository, the owner is also told that GitHub takes no file over 100 MB.",
    commands: [command],
    setup: [ask],
    summary: [section],
    contributes: { tools: [gh] },
    optional: ["tools"],
  }
}

export default function backup(): Plugin {
  return backupPlugin()
}
