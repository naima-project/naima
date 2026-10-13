# Reporting and triage

How something said, seen or found becomes an [item](../guide/glossary.md#item) someone can act on months
later, and how that item earns its place in the ranking.

**Who and when.** Whoever hears or finds it — usually the coordinator, in
the [owner](../guide/glossary.md#owner)'s chat — files it at once, before investigating (step 2). This
holds every time the owner asks for a feature, reports a problem, decides or
defers something, not only when a flow is explicitly invoked: it is a
standing behaviour, in the background, so the work underway is not derailed.
The filer then [triages](../guide/glossary.md#triage) it, in the same sitting (steps 3–7): it rewrites the
description in its own words, searches duplicates first (`naima list`, or
`naima new --dedupe`, which prints likely duplicates of the same type before
writing and still writes) and links rather than refiles, records what it
checked, and sets the fields (`naima describe`, `naima note`, `naima triage set`; step 4). The owner may also write an item directly as a file; it is
triaged the same way. A report written by the owner is never overwritten:
the triage adds to it.

## 1. Route it

Every sentence the owner says about the work is one of a few things, and each has one place. In the wrong place it is lost, and a lost
report has to be said again.

| When they say… | It goes in |
|---|---|
| "this is broken" | `bugs` |
| "this needs doing" — work, a decision, a tidy-up, not a defect | `todos` |
| "I'd like it to do X" — it does not exist | `features`, status `requested` |
| "this exists now" | `features`, status `shipped`, with its `docs` |
| "this still has to be tried" | `tests` |
| "it must always hold that Z" — a condition the result must meet | `requirements`, proven by a test linked `verifies` |
| "the behaviour must be Z" — exactly how something behaves | `specs`: a new one, or the next version of the current one (`naima spec revise`) |
| "yes, do that" / "we go with X" — the owner decides or permits | `decisions`, linked `settles` to the items that waited on it |

A defect does not go in `todos`. A request is not a feature until the code
exists. A change of behaviour is a spec change first: write the new version
of the spec, have it agreed, then build to it
([planning with requirements, specs and decisions](../guide/plan-with-requirements-specs-and-decisions.md)). If an earlier request is reversed, record the reversal — never
overwrite it.

## 2. Write it before you understand it

Open the item with what was observed, **then** investigate:

```sh
naima new bugs "<what happened, in one line>"
```

- A diagnosis that turns out wrong still leaves the observation, which was
  never wrong.
- An item opened late competes with whatever you are doing instead of being
  ranked against everything else.
- The report is [evidence](../guide/glossary.md#evidence); your reconstruction is not.

The title says what happened, not what to do.

## 3. What a report carries

1. **What happened, in your own words**: what happens, what should happen,
   and how to see it. The owner's chat is private: quote the owner's words,
   or attach a file or screenshot they shared, only after their explicit yes
   ([the rule](../guide/rules.md#the-owners-chat-stays-private)). A report a
   person wrote as a file is kept as they wrote it.
2. **The evidence**: a log line, a number, a command with its output, a file
   in `attachments/`. Evidence travels with the claim. A file goes in with
   `naima attach` (below), never copied by hand, and is **redacted before
   attaching**: a token, a key, a password or a private path in a log is cut
   out first, because an attachment is permanent once committed. A command
   and its output are copied exactly, with machine names, IP addresses, URIs
   with a port, home-directory paths and user names replaced by `<host>`,
   `<ip>`, `<path>`, `<user>`: redact before creating any item, note,
   session note, event, description or attachment
   ([the rule](../guide/rules.md#no-machine-names-or-private-infrastructure-in-a-repository)).
3. **What is measured and what is inferred, marked apart.** "Read in the
   code, certain" against what you checked; "not reproduced" against what you
   assume. An item that keeps the two apart stays useful even when its
   boldest claim turns out false.
4. **The consequence**: who notices, and when. Without it, `impact` is
   guessed, and a guessed impact makes the ranking lie.

Not a fix you have not tried, a cause you have not checked, or a severity
meant to get attention — attention is what `priority` is for.

## 4. Triage when you open it

```sh
naima triage set <item> impact=high priority=next confidence=reported
```

| Field | How to decide it |
|---|---|
| `impact` | if nobody touches this, who notices? `blocker` stops a release or loses work; `high` stops a user; `medium` is worked around; `low` only we would notice |
| `priority` | when: `now` · `next` · `later` · `parked` |
| `confidence` | do we understand it? `measured` · `diagnosed` · `reported` · `unclear` |
| `effort` | **never guessed.** Nothing in a report says what a fix costs; leave it empty until someone has looked at the code. An unsized item sinks in the ranking, which is the honest outcome |

**Classifiers take the project's values.** `area` (where it lives) and
`kind` (the mode of work; a role's name is a kind) take the values the
project lists, if it lists any: `naima types` prints each list with how many
items hold each value, and marks a value off the list. Pick a value from the
list. A new value is defined in `naima.json`'s `extends`, title and meaning,
in the same commit that first uses it; an off-list value already in the
tracker is a note from `naima check` (the check `values`) naming its items —
report it, never rewrite those items to make the note go away. `gate` and
`epic` are fixed lists: a gate no plugin contributes, or `part-of` an item that is
not an epic, fails the check.

[Triage what you touch](../guide/rules.md#triage-what-you-touch): opening,
reporting or fixing an item means leaving its fields set. `naima triage` prints coverage per type; do not add to what it
says is missing.

A `priority=now` item sitting with nobody's [claim](../guide/glossary.md#claim-file)
on it does not wait to be asked about: `naima view next` carries an age
column (days since the field was last confirmed) and marks such an item
`unclaimed`; `naima check` notes one open past
`plugins.triage.options.maxNowAgeDays` (default 3 days). Claim it
(`naima claim <item>`) or drop it back to `next` if nobody is actually
picking it up.

**The page is written by command, never by hand.** Two commands write the
item's page, `README.md`, through every plugin's write hooks:

```sh
naima describe <item> --file triaged.md          # the description, rewritten in your own words
naima note <item> "Reproduced on 16-bit PNGs only; 8-bit keeps alpha." --by "triage agent"
```

- `naima describe` replaces the description and keeps the title line and the
  Notes section. Rewrite a report an agent filed; never one a person wrote,
  which the triage adds to with a note instead. The title is a field:
  `naima set <item> title="…"`, which rewrites the page's title line too, in
  the same write.
- An item filed under the wrong type (a bug that is really a request) moves
  with `naima move <item> <type>`, keeping its id, links and notes; it refuses
  a status or a field the new type does not declare, unless `--force`.
- `naima note` appends a dated entry, with who wrote it (`--by`, else git's
  `user.name`) and the branch, to the Notes section. Notes are append-only:
  a write that changes an earlier one is refused. Record there what you
  checked, measured apart from inferred.
- Both take `--file` for a longer text, and refuse an empty one (exit 2).
- **What goes in is your own words.** Neither command takes the owner's chat:
  paraphrase it. A verbatim quote, or a file the owner shared, goes in only
  after their explicit yes, and the note says that they gave it
  ([the rule](../guide/rules.md#the-owners-chat-stays-private)).
- `naima attach <item> <file>` copies a file into the item's `attachments/`
  and records on the item, in the field `attached`, whose it is. A file the
  owner shared goes in only after their explicit yes, restated:
  `--consent "Yes, attach my screenshot of the export"`. Your own material —
  a log, a test's output — takes `--own`. With neither it is refused, and so
  is a file holding a secret (the check `secrets` names the line): redact it
  and attach again. `--as <name>` renames it; a name already taken is refused.
- Every one of these writes — `new`, `describe`, `note`, `set`, `attach`, and
  `pass` and `event` — is refused when it adds a machine name, an IP address,
  a URI with a port, a home-directory path, the user's name or a word of the
  private list, each listed with its placeholder: rewrite it with `<host>`,
  `<ip>`, `<path>`, `<user>` and run it again. `--allow-private "<reason>"`
  lets a deliberate mention through and records why
  ([the rule](../guide/rules.md#no-machine-names-or-private-infrastructure-in-a-repository)).
- `naima check` holds both: `attachment-consent` fails on an attachment a
  branch adds with no record (copied in by hand), on a record whose file is
  gone, and on the owner's file with no yes; `secrets` fails on a private key
  with its body, or an AWS, GitHub, Slack, API-secret or Google key, in any
  project file or attachment. An exception lives in the `privacy` plugin's
  options with a reason and an item, and is added only on the trunk: the list
  only shrinks.

## 5. Deferring: say why, and what reopens it

Not everything triaged gets worked on now. An item with `priority=parked`, or
a bug `wontfix` or a todo `dropped`, is a **deferral**, not a loss: it is
still captured in full (steps 2–4) exactly as any other item, with its
reason on the page, then set
[`reopensWhen`](../guide/glossary.md#reopenswhen) — prose, or a link to the
item or document whose change would make it worth re-arguing. An item left
without a reason, or without `reopensWhen`, is a problem `naima check`
reports: a deferral nobody can act on is silently re-argued the next time
someone notices it.

`naima view parked` lists every parked, wontfix or dropped item with its
trigger. Read it before opening a new item that looks familiar: when the
thing being reported is already there, the answer is **"I already told
you"** — point at the existing item and its `reopensWhen`, rather than
triaging a duplicate. When `reopensWhen` has come true, reopen the item
(`naima set <item> priority=next` or `naima set <item> status=open`) instead
of filing a new one.

A project's own authoritative documents — which page is the one to trust for
a given kind of status — are declared in `plugins.triage.options.documents`
and printed first by `naima guide`. A project rule can say so explicitly
(`naima rules`, this one's: "no new status or summary document — update the
authoritative one"): update the document named there, never start a new one
beside it.

## 6. Cross-reference instead of repeating

Items name each other by permanent id (`naima link`), never by a slug in
prose:

- a test `verifies` the item it proves;
- a duplicate is `duplicate-of` its twin, and the twin keeps the evidence;
- an item that waits on another is `blocked-by` it.

## 7. Whose hands does the proof need

`runBy` says who can perform the gesture, by the instrument:

- `agent` — a command settles it: a unit test, a grep, an API call;
- `agent-hands` — an agent driving the running software settles it;
- `human` — only a person, and `humanBecause` says why
  ([asking the human](asking-the-human.md));
- `build` — an artefact nobody here makes.

Mark it with more care than any other field: it decides who picks the gesture
up, and both mistakes are expensive.

## 8. Closing

A fix is not a close. Closing takes the fix (`fixedOn`), the gesture that
proves it as an item linked `verifies`, and the gesture performed and passed —
then `naima close` moves the item to the archive, carrying its [proof](../guide/glossary.md#proof), so a
regression is recognised when it comes back. Fixed but unproven stays open:
the shape of a result is not its behaviour.

The proof must also be **current**. `naima close` refuses when:

- an item verifying it **refutes** it — a test that `failed`, a property
  that is `violated`: evidence against outweighs any evidence for;
- `naima check` finds a problem on an item verifying it — a property that
  holds on a model, an included file, a tool version, property, [verifier](../guide/glossary.md#verifier) or options changed since its run. Run
  the gesture again (`naima verify`), then close.

Never close, or set `holds`, by editing `meta.json` or moving a directory:
every write hook that would refuse it has a check counterpart, so the hand
edit fails `naima check` — `closed-not-claimed` on an archived item the
branch you stand on still claims, `property-evidence` on a `holds` with no
current run.

## Safety rules

- **No attachment with no consent record.** Enforced by the check
  `attachment-consent`: it fails a file copied in by hand, a record whose
  file is gone, and the owner's file with no recorded yes.
- **No secret in an item or an attachment.** Enforced by the check `secrets`.
- **A fixed item is never closed without a passing proof.** Enforced by
  `naima close` and the check `closed-carries-proof`.
- **No write a command would refuse, made by hand.** Enforced by the check
  counterpart of every write hook that protects a state: `closed-not-claimed`,
  `property-evidence` and `epics`.
- **Evidence against a claim outweighs evidence for it.** Enforced by `naima
  close`, which refuses an item a verifying item refutes.
