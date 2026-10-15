# Configuration

This page describes every key of `naima-tracker/naima-data/naima.json`. The
common tasks are explained step by step in
[configure the project](configure-the-project.md), and the terms are defined
in the [glossary](glossary.md). The agents edit this file for you unless you
want to do it yourself.

## The automatic principle

Naima tries to work without any configuration. Every first-party plugin
(`trackers`, `coordination`, `triage`, `gates`, `beta-markers`, `verifier`,
`docs`, `rules`) is loaded, and every default is inferred from the
repository. For example, beta markers are looked for in every file git tracks
(or would track), and the docs check follows the links of every tracked
markdown file. The program in `naima-tracker/naima/` is never counted as one
of the project's files, even when it is committed. If a project needs nothing
else, it doesn't have to configure anything.

`naima-tracker/naima-data/naima.json` holds only what Naima can't infer:

- the **formats** of the data, and the **lock**, which says which Naima runs
  the project (`source`, `commit`, optionally `verify`) and where it is
  (`program`);
- the **update policy**, `updates`, which says what a session start does
  about a newer Naima. It is `off`, `check` (the default) or `update`, and the
  agent sets it with `naima update --mode`
  ([update Naima](update-naima.md#what-happens-when-a-session-starts));
- the **`plugins` table**, which records what the project decides about each
  plugin: its options (the project's [gates](glossary.md#gate) are options of
  the `gates` plugin), whether it is switched off or replaced, any
  third-party plugin added, and any check weighed differently;

- the project's own **extensions** of the loaded plugins' types and fields,
  under `extends`, such as a status added to a type, a type made `fixable`,
  an enum value added, or the list of values that `area` or `kind` takes
  ([extending](../reference/plugin-contract.md#extending-another-plugins-types-and-fields);
  [value lists](configure-the-project.md#define-the-values-a-field-takes)).

`naima init` writes the formats and the lock, and nothing else is needed.
Every key is listed with its default in
[the format](../reference/format.md#naimajson).

## The plugins table

`plugins` maps a plugin's name to what the project decides about it. A
first-party plugin that the table doesn't name is loaded as it is.

```json
{
  "plugins": {
    "gates": { "options": { "gates": { "v1": { "title": "First release", "holdsOn": "code" } } } },
    "docs": { "options": { "reference": "docs/reference.md" }, "checks": { "links-resolve": "note" } },
    "beta-markers": { "enabled": false },
    "trackers": { "replacedBy": "plugins/my-trackers.ts" },
    "core": { "checks": { "duplicates": "problem" } },
    "mine": { "source": "plugins/mine.ts", "options": { "strict": true } }
  }
}
```

`naima plugin` turns a plugin on or off, or sets one of its options, so that
nobody has to edit the file by hand. The commands are
`naima plugin enable <name>`, `naima plugin disable <name>` and
`naima plugin set <name> <option>=<value>...` (an empty value removes the
option), plus `naima plugin show [<name>]` to see what is set now and what a
plugin's options are. It refuses a name that is neither first-party nor
already in the table with its own `source`, and it refuses an option the
plugin doesn't declare. It exists mainly for opt-in plugins that start a
program, such as `verifier-mcrl2`, which you turn on with
`naima plugin enable verifier-mcrl2` and then
`naima plugin set verifier-mcrl2 bin=/usr/local/bin`. Changing a plugin's
`checks` and adding a third-party plugin's `source` still have to be done by
editing the file.

| Key | Default | What it is |
|---|---|---|
| `options` | `{}` | the plugin's own options, as its reference documents them: the `gates` plugin's `gates`, the `docs` plugin's `reference`, `beta-markers`' `paths` |
| `enabled` | `true` | `false` switches the plugin off: it is not loaded, and nothing it declares exists |
| `replacedBy` | none | for a first-party plugin: the module that runs under its name instead, such as a fork or an alternative |
| `source` | none | for a third-party plugin, required: its module, pinned (below) |
| `checks` | `{}` | check name → `off`, `note` or `problem`: how much each of the plugin's checks weighs here |

The project chooses the name. A plugin is registered under the name of its
entry, whatever its manifest says, so a replacement keeps the name of the
plugin it replaces. A name is made of lowercase letters, digits and dashes,
and starts with a letter.

`core` is the entry for the core itself. The core can't be switched off or
replaced and takes no options, so only its checks can be weighed.

### Check severity

Much as a linter lets you weigh its rules, a project can weigh each check. A
check set to `problem` fails `naima check`, one set to `note` is reported but
never fails it, and one set to `off` isn't run. A check the plugin doesn't
declare is refused when the project loads, so a misspelt name can't silently
do nothing. The reference documents every check with the weight its plugin
gives it.

### Gates

The `gates` plugin's `gates` option maps a gate name to
`{ "title", "says", "holdsOn" }`. How a gate decides whether it holds is
described in the [reference](../reference/reference.md#gates). Format 1 kept
this as a top-level `gates` key, and the `gates` plugin's own migration moves
it here.

## Third-party plugins

Plugin code only runs from a pinned source, never from the data or from a
package. A third-party plugin's entry names that source in `source`, and can
also give options:

```json
{
  "plugins": {
    "mine": { "source": "plugins/mine.ts" },
    "tools": { "source": { "path": "tools/naima-plugin.mjs", "sha256": "…" }, "options": { "strict": true } },
    "ops": { "source": { "git": "https://example.org/ops-plugin.git", "commit": "…", "path": "index.mjs" } }
  }
}
```

- a **path inside the program**, for a module that a fork of Naima carries
  ([modifying Naima](install.md#modifying-naima)). A path that leads outside
  the program is refused.
- a **file of the project** with its **sha256**. As soon as the file changes
  it is refused, with a message naming the new hash, until the pin is
  updated.
- a **git repository** at a full **commit**, with the module's path inside
  it. It is fetched once into `naima-tracker/plugins/<name>/`, which git
  ignores, and refused if that checkout has local changes.

`replacedBy` accepts the same three forms. A `source` on a first-party name
is refused, because that plugin is already loaded and `replacedBy` is the way
to replace it. The module's default export is a factory that takes the
options and the plugin API and returns the manifest, which states the
contract the plugin is written for
([plugin contract](../reference/plugin-contract.md#shape)). If two plugins
declare the same name, that is an error when the project loads.
