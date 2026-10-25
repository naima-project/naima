// The owner's privacy and the project's secrets. A file enters an item's
// attachments through `naima attach`, which records whose it is — the owner's,
// with the owner's yes restated, or the writer's own — and refuses one holding
// a secret; `naima check` flags an attachment a branch adds with no such
// record, and any secret in the project's files or attachments. Every write of
// free text or a file is signed against the no-leaks checklist the program
// ships (docs/agents/NOLEAKS.md): `--revised <its path>`, or it is refused.

import { createHash } from "node:crypto"
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { basename, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  ATTACHMENTS,
  beforeTextWrite,
  bool,
  type Check,
  type Command,
  type Context,
  CONTRACT,
  type FieldDef,
  type Finding,
  findPrivate,
  gitOrNull,
  gitPath,
  guardPrivate,
  isGitRepo,
  isRegularFile,
  type Item,
  joinProse,
  label,
  NOTES_HEADING,
  parse,
  type Plugin,
  type PluginApi,
  posixRelative,
  privateContext,
  projectFiles,
  readReadme,
  saveMeta,
  saveProse,
  splitProse,
  str,
  today,
  trackerPath,
  trunk,
  usageError,
  walkFiles,
  type Write,
  type WriteHook,
} from "../../core/api.ts"

/** One secret shape: its name, said after an article, and how it is found. */
interface Shape {
  name: string
  pattern: RegExp
}

/**
 * The shapes a secret takes. A private key counts only with a body after its
 * header — a line of base64 — so a page that names the header is not one.
 */
const SHAPES: readonly Shape[] = [
  {
    name: "private key",
    pattern: /-----BEGIN (?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED|PGP) )?PRIVATE KEY(?: BLOCK)?-----[ \t]*\r?\n(?:[A-Za-z-]+:[^\n]*\n)*\s*[A-Za-z0-9+/=]{40,}/g,
  },
  { name: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/g },
  { name: "Slack token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { name: "API secret key", pattern: /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}|[sr]k_live_[A-Za-z0-9]{24,})/g },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
]

/** One secret found in a text: its shape and the line it starts on, from 1. */
export interface Secret {
  shape: string
  line: number
}

/** Every secret in `text`, in the order they appear. */
export function findSecrets(text: string): Secret[] {
  const out: (Secret & { at: number })[] = []
  for (const s of SHAPES) {
    for (const m of text.matchAll(s.pattern)) out.push({ shape: s.name, at: m.index, line: text.slice(0, m.index).split("\n").length })
  }
  return out.sort((a, b) => a.at - b.at).map(({ shape, line }) => ({ shape, line }))
}

const article = (shape: string): string => `${/^[AEIOU]/.test(shape) ? "an" : "a"} ${shape}`

/** Larger files are not read: no secret is pasted into a file this size by hand. */
const MAX_BYTES = 2 * 1024 * 1024

/** Why `file` cannot be attached: missing, not a plain file, or outside what Naima may read. */
function unreadable(file: string, src: string): string {
  try {
    lstatSync(src)
  } catch (e) {
    const code = (e as { code?: string; name?: string }).code ?? (e as { name?: string }).name
    if (code === "ENOENT" || code === "NotFound") return `${file} does not exist`
    return `${file} cannot be read: Naima reads only inside the project — copy the file into the project first, then attach the copy`
  }
  return `${file} is not a plain file`
}

/** A file's text, or null for one too large or binary (a NUL in its first 8 KiB). */
function textOf(path: string): string | null {
  try {
    if (statSync(path).size > MAX_BYTES) return null
    const buf = readFileSync(path)
    return buf.subarray(0, 8192).includes(0) ? null : buf.toString("utf8")
  } catch {
    return null
  }
}

/** An exception of the secrets check: a file allowed to hold one, why, and the item that tracks it. */
interface Exception {
  path: string
  reason: string
  item: string
}

/** Whose an attachment is, as `naima attach` records it. */
interface Provenance {
  from: "owner" | "agent"
  consent?: string
  by: string
  on: string
  revised?: unknown
}

/** The no-leaks checklist, from the program directory: the file `--revised` must name. */
export const CHECKLIST = "docs/agents/NOLEAKS.md"

/** The program's own copy of the checklist, next to this code. */
const SHIPPED = fileURLToPath(new URL(`../../../${CHECKLIST}`, import.meta.url))

/** A signature as a signed write records it: the checklist's hash (the first 16 hex digits of its SHA-256), who if known, the day. */
export interface Signature {
  checklist: string
  by?: string
  on: string
}

const hashOf = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex").slice(0, 16)

const SIGNED: FieldDef = {
  name: "revised",
  kind: "object",
  says:
    "the last no-leaks signature on the item's free text, which naima fills on a signed write: { checklist: the first 16 hex digits of the checklist's SHA-256, by: who, when git says, on: the day }; git's history holds the earlier ones",
}

/** Fields that hold free text: the title, a string field with no list of values, and any string field no plugin declares. */
function freeText(write: Write, ctx: Context): boolean {
  if (write.kind === "create") return true
  const before: { [k: string]: unknown } = write.before ?? {}
  if (write.prose !== undefined && write.prose !== readReadme(write.item)) return true
  for (const [name, value] of Object.entries(write.item.meta)) {
    if (name === "id" || name === "status" || name === "links" || name === SIGNED.name) continue
    if (typeof value !== "string" || value === before[name]) continue
    const def = ctx.registry.fields.get(name)
    if (name === "title" || !def || (def.kind === "string" && !Object.keys(def.values ?? {}).length)) return true
  }
  return false
}
const ATTACHED: FieldDef = {
  name: "attached",
  kind: "object",
  says:
    "whose each attachment is, as naima attach records it: file name → { from: owner or agent, consent: the owner's yes restated (for the owner's), by, on }",
}

const GENERATED = ["run-*.json", "test-run-*.json", "counterexample-*.txt"]

const glob = (pattern: string): RegExp => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")}$`)

const isObject = (v: unknown): v is { [k: string]: unknown } => !!v && typeof v === "object" && !Array.isArray(v)

/** The attachment records of an item: an empty map when it has none, or the field is not an object (the fields check reports that). */
const recordsOf = (
  item: Item,
): { [name: string]: unknown } => (isObject(item.meta[ATTACHED.name]) ? item.meta[ATTACHED.name] as { [name: string]: unknown } : {})

/** The files in an item's attachments, by name from attachments/, but hidden ones (.gitkeep). */
function attachmentsOf(item: Item): string[] {
  const dir = join(item.dir, ATTACHMENTS)
  return walkFiles(dir)
    .map((f) => gitPath(relative(dir, f)))
    .filter((n) => !n.split("/").some((part) => part.startsWith(".")))
}

/**
 * The contents the trunk holds under `dir`, as git blob ids, or null outside
 * git or with no trunk. By content, not by path: an item closed or moved on a
 * branch keeps attachments the trunk already has.
 */
function trunkBlobs(ctx: Context, dir: string): Set<string> | null {
  if (!isGitRepo(ctx.trackerGit)) return null
  const name = trunk(ctx.trackerGit)
  if (!name) return null
  const listed = gitOrNull(ctx.trackerGit, "ls-tree", "-r", "-z", name, "--", dir || ".") ?? ""
  return new Set(listed.split("\0").flatMap((l) => l.split("\t")[0]?.split(" ")[2] ?? []))
}

/** The git blob id of each file, by path from the project root; empty outside git. */
function blobsOf(ctx: Context, paths: string[]): Map<string, string> {
  const out = new Map<string, string>()
  if (!isGitRepo(ctx.root)) return out
  for (let i = 0; i < paths.length; i += 200) {
    const chunk = paths.slice(i, i + 200)
    const ids = (gitOrNull(ctx.root, "hash-object", "--", ...chunk) ?? "").split("\n")
    chunk.forEach((p, n) => ids[n] && out.set(p, ids[n]))
  }
  return out
}

/** Who writes: `--by`, else git's user.name; refused when neither says. */
function author(ctx: Context, by: string | undefined): string {
  const who = by?.trim() || (isGitRepo(ctx.root) ? gitOrNull(ctx.root, "config", "user.name") : null)
  if (!who) throw new Error("say who attaches the file: --by <name>, or set git's user.name")
  return who
}

export default function privacy(options: { [key: string]: unknown } = {}, api?: PluginApi): Plugin {
  const self = api?.plugin ?? "privacy"
  const generated = (Array.isArray(options["generated"]) ? options["generated"].map(String) : GENERATED).map(glob)
  const exceptions: unknown[] = Array.isArray(options["exceptions"]) ? options["exceptions"] : []
  const signing = options["signed"] !== false

  /** The checklist's path as the project names it: under its program directory. */
  const checklistPath = (ctx: Context): string => posixRelative(ctx.root, join(ctx.program, CHECKLIST)) || CHECKLIST

  /** The signature of this command's write, or the refusal: no --revised, or a file that is not the shipped checklist. */
  function sign(ctx: Context, what: string): Signature | string {
    const path = checklistPath(ctx)
    const how = `read ${path}, check the text against every point of it, and run the command again with --revised ${path}`
    if (ctx.revised === undefined) {
      return `nothing written: ${what} is free text, which enters the tracker only signed against the no-leaks checklist — ${how}`
    }
    let given: Uint8Array
    try {
      given = readFileSync(ctx.revised)
    } catch {
      return `nothing written: --revised names ${ctx.revised}, which cannot be read — ${how}`
    }
    const shipped = hashOf(readFileSync(SHIPPED))
    if (hashOf(given) !== shipped) {
      return `nothing written: --revised names a file that is not the no-leaks checklist this Naima ships, so it signs nothing — ${how}`
    }
    const by = isGitRepo(ctx.root) ? gitOrNull(ctx.root, "config", "user.name")?.trim() : undefined
    return { checklist: shipped, ...(by ? { by } : {}), on: today(ctx) }
  }

  const signedWrites: WriteHook = {
    name: "signed-writes",
    says:
      "a write of free text the writer authored (naima new, describe, note, a free-text field with naima set) is refused unless --revised names the no-leaks checklist the program ships, byte for byte; the signature (the checklist's hash, who, the day) goes in the item's field revised. Session notes, events and attachments are held the same way and carry it in their own record. Statuses, links, claims and what Naima fills or generates need none; the option signed: false turns it off",
    beforeWrite(write, ctx) {
      if (!signing || !write.authored || !freeText(write, ctx)) return
      const s = sign(ctx, `the text of ${label(write.item)}`)
      if (typeof s === "string") return s
      write.item.meta = { ...write.item.meta, [SIGNED.name]: s }
    },
    beforeText(text, ctx) {
      if (!signing) return
      const s = sign(ctx, text.what)
      if (typeof s === "string") return s
      text.record[SIGNED.name] = s
    },
  }

  const attach: Command = {
    name: "attach",
    says:
      "copy a file into an item's attachments with a record of whose it is: the owner's, only with their explicit yes restated in --consent, or your own with --own; a file holding a secret is refused",
    enforces:
      "an owner's file is attached only with their yes restated in --consent, or the writer's own with --own; a file holding a secret, a hidden or path-like name, or a name already used is refused, and so is a text holding private infrastructure (a machine name, an IP address, a URI with a port, a home-directory path, the user's name, a word of the private list) unless --allow-private \"<reason>\" is given, which the item's notes record",
    usage: 'attach <item> <file> (--consent "<the owner\'s yes, restated>" | --own) [--as <name>] [--by <who>]',
    options: [
      { name: "--consent", says: "the file is the owner's: their explicit yes to storing it, restated; recorded on the item" },
      { name: "--own", says: "the file is the writer's own material: a log, a test's output, a measurement" },
      { name: "--as", says: "the name it takes in attachments/", default: "the file's own name" },
      { name: "--by", says: "who attaches it; without it, git's user.name" },
    ],
    examples: [
      'attach export-drops ~/Desktop/alpha.png --consent "Yes, attach my screenshot of the export"',
      "attach export-drops test-run.out --own --as proof.out",
    ],
    run(args, ctx) {
      const p = parse(args, { consent: { type: "string" }, own: { type: "boolean" }, as: { type: "string" }, by: { type: "string" } })
      const [ref, file, ...rest] = p.positionals
      if (!ref?.trim() || !file?.trim() || rest.length) throw usageError(this)
      const consent = str(p, "consent")?.trim()
      const own = bool(p, "own")
      if (consent !== undefined && own) throw new Error("give one of --consent and --own: a file is the owner's or yours")
      if (!consent && !own) {
        throw new Error(
          `say whose the file is: --consent "<the owner's yes, restated>" for the owner's material, given only after they said yes, or --own for your own (a log, a test's output)`,
        )
      }
      const item = ctx.repo.resolve(ref)
      const name = str(p, "as") ?? basename(file)
      if (!name || /[/\\]/.test(name) || name.startsWith(".")) throw new Error(`"${name}" is no attachment name: a plain file name, not hidden`)
      const src = resolve(file)
      if (!isRegularFile(src)) throw new Error(unreadable(file, src))
      const text = textOf(src)
      const secret = text === null ? undefined : findSecrets(text)[0]
      if (secret) {
        throw new Error(`${file}:${secret.line} holds ${article(secret.shape)}: redact it before attaching — an attachment is permanent once committed`)
      }
      const allowance = text === null ? undefined : guardPrivate(`attachment ${name}`, findPrivate(text, privateContext()), ctx.allowPrivate)
      const signature = beforeTextWrite(ctx, `attachment ${name}`)
      const dest = join(item.dir, ATTACHMENTS, name)
      const records = recordsOf(item)
      const inPlace = src === resolve(dest)
      if (Object.hasOwn(records, name) || (existsSync(dest) && !inPlace)) {
        throw new Error(`${label(item)} already holds ${name}: attach it under another name with --as`)
      }
      const record: Provenance = {
        ...(consent ? { from: "owner", consent } : { from: "agent" }),
        by: author(ctx, str(p, "by")),
        on: today(ctx),
        ...signature,
      } as Provenance
      if (!inPlace) {
        mkdirSync(join(item.dir, ATTACHMENTS), { recursive: true })
        copyFileSync(src, dest)
      }
      try {
        saveMeta(ctx, { ...item, meta: { ...item.meta, [ATTACHED.name]: { ...records, [name]: record } } })
      } catch (e) {
        if (!inPlace) rmSync(dest, { force: true })
        throw e
      }
      if (allowance) {
        const prose = splitProse(readReadme(item))
        const entry = `### ${today(ctx)} — naima\n\n${name}: ${allowance}`
        saveProse(ctx, item, joinProse({ ...prose, notes: [prose.notes || NOTES_HEADING, entry].join("\n\n") }))
      }
      ctx.out(`${label(item)}: attached ${name} (${consent ? "the owner's, consent recorded" : "your own"})`)
      return 0
    },
  }

  const consentCheck: Check = {
    name: "attachment-consent",
    says:
      "every attachment a branch adds has a record of whose it is (naima attach), every record names a file that is there, and the owner's carry their yes; what the trunk already holds, and what a tool writes itself, is not asked",
    run(ctx) {
      const out: Finding[] = []
      const onTrunk = trunkBlobs(ctx, ctx.trackerPrefix)
      const unrecorded: { item: Item; name: string; path: string }[] = []
      for (const item of ctx.repo.items) {
        const records = recordsOf(item)
        const here = gitPath(relative(ctx.root, join(item.dir, ATTACHMENTS)))
        for (const name of attachmentsOf(item)) {
          if (!Object.hasOwn(records, name) && !generated.some((g) => g.test(name))) unrecorded.push({ item, name, path: `${here}/${name}` })
        }
      }
      const blobs = onTrunk?.size ? blobsOf(ctx, unrecorded.map((u) => u.path)) : new Map<string, string>()
      for (const { item, name, path } of unrecorded) {
        if (onTrunk?.has(blobs.get(path) ?? "")) continue
        out.push({
          level: "problem",
          item,
          message: `${label(item)}: ${ATTACHMENTS}/${name} has no consent record — naima attach ${
            label(item)
          } ${path} --consent "<the owner's yes>" if it is the owner's (after asking), --own if it is yours; or remove it`,
        })
      }
      for (const item of ctx.repo.items) {
        const records = recordsOf(item)
        const files = attachmentsOf(item)
        for (const [name, raw] of Object.entries(records)) {
          if (!files.includes(name)) {
            out.push({ level: "problem", item, message: `${label(item)}: ${ATTACHED.name} names ${name}, which is not in ${ATTACHMENTS}/` })
            continue
          }
          const r = isObject(raw) ? raw : {}
          if (r["from"] === "owner" && !(typeof r["consent"] === "string" && r["consent"].trim())) {
            out.push({
              level: "problem",
              item,
              message: `${label(item)}: ${ATTACHMENTS}/${name} is the owner's, with no consent recorded — ask them, or remove it`,
            })
          } else if (r["from"] !== "owner" && r["from"] !== "agent") {
            out.push({ level: "problem", item, message: `${label(item)}: the record of ${ATTACHMENTS}/${name} says neither owner nor agent` })
          }
        }
      }
      return out
    },
  }

  const secretsCheck: Check = {
    name: "secrets",
    says:
      "no project file or attachment holds a private key with its body, or an AWS, GitHub, Slack, API-secret or Google key; an exception names its file, a reason and an item, and the list of exceptions only shrinks",
    run(ctx) {
      const out: Finding[] = []
      const excepted = new Map<string, boolean>()
      for (const raw of exceptions) {
        const e = (isObject(raw) ? raw : {}) as Partial<Exception>
        const path = typeof e.path === "string" ? e.path : ""
        let tracked = false
        try {
          tracked = typeof e.item === "string" && !!ctx.repo.resolve(e.item)
        } catch { /* reported below */ }
        if (!path || !(typeof e.reason === "string" && e.reason.trim()) || !tracked) {
          out.push({
            level: "problem",
            message: `${self}: the exception for ${path || "(no path)"} needs a reason and an item that exists: { path, reason, item }`,
          })
        }
        if (path) excepted.set(path, false)
      }
      const onTrunk = excepted.size ? trunkExceptions(ctx) : null
      if (onTrunk) {
        for (const path of excepted.keys()) {
          if (!onTrunk.paths.has(path)) {
            out.push({
              level: "problem",
              message: `${self}: the exception for ${path} is not on the trunk (${onTrunk.name}): the list only shrinks — redact the file instead`,
            })
          }
        }
      }
      const files = new Set(projectFiles(ctx.root, ctx.program))
      for (const item of ctx.repo.items) {
        for (const name of attachmentsOf(item)) files.add(gitPath(relative(ctx.root, join(item.dir, ATTACHMENTS, name))))
      }
      for (const file of [...files].sort()) {
        const text = textOf(join(ctx.root, file))
        if (text === null) continue
        const found = findSecrets(text)
        if (!found.length) continue
        if (excepted.has(file)) {
          excepted.set(file, true)
          continue
        }
        for (const s of found) {
          out.push({ level: "problem", message: `${file}:${s.line}: ${article(s.shape)} — remove it and revoke it; history keeps what was committed` })
        }
      }
      for (const [path, used] of excepted) if (!used) out.push({ level: "note", message: `${self}: the exception for ${path} matches no secret: remove it` })
      return out
    },
  }

  /** The exception paths in the trunk's configuration, or null when there is no trunk to compare with. */
  function trunkExceptions(ctx: Context): { name: string; paths: Set<string> } | null {
    if (!isGitRepo(ctx.trackerGit)) return null
    const name = trunk(ctx.trackerGit)
    if (!name) return null
    const text = gitOrNull(ctx.trackerGit, "show", `${name}:${trackerPath(ctx.trackerPrefix, "naima.json")}`)
    let list: unknown = []
    try {
      const raw: unknown = text ? JSON.parse(text) : {}
      const entry = isObject(raw) && isObject(raw["plugins"]) ? raw["plugins"][self] : undefined
      list = isObject(entry) && isObject(entry["options"]) ? entry["options"]["exceptions"] : []
    } catch { /* an unreadable trunk configuration holds no exception */ }
    const paths = new Set((Array.isArray(list) ? list : []).flatMap((e) => (isObject(e) && typeof e["path"] === "string" ? [e["path"]] : [])))
    return { name, paths }
  }

  return {
    name: "privacy",
    contract: CONTRACT,
    says: "the owner's material enters the repository only with their recorded yes, and no secret enters it at all",
    about: "The conversation between the owner and an agent is private: nothing from it is copied into the repository without the owner's explicit yes. " +
      "A file enters an item's `attachments/` through `naima attach`, which records on the item, in the field `attached`, whose it is: the owner's (`--consent`, their yes restated) or the writer's own (`--own`). " +
      "The check `attachment-consent` flags an attachment with no record — one copied in by hand — unless the trunk already holds it, or a tool of the program writes it itself (a property's run records). " +
      "The check `secrets` reads every project file and every attachment for six shapes of secret: a private key with its body (a header alone is not one), and AWS, GitHub, Slack, API-secret and Google keys; `naima attach` refuses a file holding one. " +
      "A file that must keep one is an exception in the plugin's options, with a reason and the item that tracks it; an exception the trunk's configuration does not hold is refused, so the list only shrinks. " +
      "Every write of free text or a file — a title, a description, a note, a free-text field, a session note, an event, an attachment — is signed against the no-leaks checklist the program ships, `docs/agents/NOLEAKS.md`: the writer passes its path with `--revised`, and the write hook `signed-writes` compares the file with the program's own copy, byte for byte, and refuses the write without it or with any other file. " +
      "The signature, the checklist's hash with who signed and the day, goes in the item's field `revised`, in a session note's or an event's front matter, and in an attachment's record, so every write shows which version of the checklist it was checked against. " +
      "Statuses, enums, dates, links, claims, the fields Naima fills and the records it generates need no signature. The option `signed: false` turns the requirement off for a project.",
    options: [
      {
        name: "exceptions",
        says: "files allowed to hold a secret: a list of { path, reason, item }, path from the project root; one not on the trunk is refused",
        default: "[]",
      },
      { name: "generated", says: "attachment names a tool writes itself, which need no record: shell-style patterns", default: JSON.stringify(GENERATED) },
      {
        name: "signed",
        says: "every write of free text or a file needs --revised naming the no-leaks checklist the program ships; false lets unsigned writes through",
        default: "true",
      },
    ],
    fields: [ATTACHED, SIGNED],
    hooks: [signedWrites],
    commands: [attach],
    checks: [consentCheck, secretsCheck],
  }
}
