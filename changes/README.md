# Change notes

Each file in this folder describes one change to how Naima behaves. When a
project updates Naima, `naima update --check` and `naima hello` read the notes
between the version the project is locked to and the newer one, and show them
before anything changes. The release notes are put together from them too,
with `naima changes`.

A change of behaviour is meant in the widest sense: a command, an option or
the plugin API; how a person or an agent uses Naima; and the workflows, which
means the flows and skills agents follow, the rules they acknowledge, and the
order of the steps they take. Any branch that changes one of these adds a
note on the same branch. The paths that count are listed in
[config.json](config.json): the program (`naima.ts`, `src/`), the skills
(`skills/`) and the rules page (`docs/guide/rules.md`). `naima land` refuses a
branch that changes them without a note. If the change really alters nothing
anyone can see, such as a refactor or a new test, the coordinator lands it
with `--no-change-note "<reason>"`, and the reason is kept in the landing
commit.

## Writing a note

Name the file after the day and the change, `<YYYY-MM-DD>-<slug>.md`, for
example `2026-10-13-naima-land.md`. Start it with a short header between two
`---` lines, then write the note itself in a few plain sentences: what is new
or behaves differently, and what a person or an agent now does.

```markdown
---
title: Landings are marker commits, made with naima land
kind: feature
affects:
  - api
  - workflow
commands:
  - added land
checks:
  - added landings-are-markers
rules:
  - added Every landing is a marker naming the items it closes
---

A branch now enters the trunk as one merge commit that names the items it
closes. The coordinator makes it with naima land.
```

The header holds these fields:

| Field | What it holds |
|---|---|
| `title` | The change in one line. Required. |
| `kind` | `breaking`, `behaviour-change`, `feature` or `fix`. Required. A breaking change is one a project has to act on, or something stops working. |
| `affects` | One or more of `api` (commands, options, the plugin API), `usage` (how Naima is used day to day), `workflow` (flows, skills, rules, the order of steps) and `data` (the tracker's files and formats). Required. |
| `commands` | Commands added, changed, removed or renamed, one per line, each starting with that word: `added land`. |
| `options` | Options the same way, by their path in `naima.json`. A rename is written `renamed <old path> to <new path>`, and a removal `removed <path>`: `naima update` makes both changes to a project's `naima.json` by itself and says what it did. |
| `checks` | Checks added, changed or removed, by name. |
| `rules` | Rules added, changed or removed, by their heading on the rules page. After an update, agents are asked to read these again and acknowledge them. |
| `migrations` | Each change to the data format, in a few words. The migration itself is code, and `naima update` runs it. |
| `action` | What a project has to do after updating, as an instruction. Leave it out when there is nothing to do. |

Each field goes on its own line, as `name: value`, or as `name:` followed by
lines that start with `  - `. Put a value in double quotes when it contains a
colon followed by a space, or starts with a quote or a dash. `naima check`
reports any file in this folder that isn't a valid note.
