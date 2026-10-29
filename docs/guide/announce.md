# Announce only what is true

What your project tells the world in its release notes, changelog, README and site is worked out from the tracker rather than from anyone's memory. A
[feature](glossary.md#feature) can be announced once it is _announceable_, which means it is user-facing, shipped, documented, and checked by a person or end to
end. The agents run the commands on this page for you, unless you want to run them yourself.

## Mark what a feature is for

Two fields describe this, and they can be set on the feature when it is filed or at any later time:

```sh
naima set features/search facing=user      # someone using the software sees it
naima set features/cache facing=internal   # only who works on it does: never announced
naima set features/search major=true       # an announcement leads with it
```

## See what may be announced

```console
$ naima announce
2 announceable
  ★ features/search  Search  (shipped 2026-01-10)
  · features/export  Export  (shipped 2026-01-12)
```

`★` marks a major feature. `naima announce --since 2026-01-01` keeps only the features shipped (`fixedOn`) since that date, and `naima announce --gate v1` keeps
those on a [gate](glossary.md#gate), which is what a release made from that gate announces. `--json` prints the same list as data.

A feature closed with `naima close` is still announced: closing takes it fixed and proven, so it counts as shipped. Closing keeps its fields, and `facing`,
`major` and `docs` can still be set on it in the archive.

## The changelog

When the project keeps change notes, one file for each change of behaviour in a `changes/` folder ([the format](../../changes/README.md)), the changelog is put
together from them:

```sh
naima changes --from v1.0.0
```

This prints the release notes for everything since that tag, as Markdown, with breaking changes and the changes you have to act on first, then new features,
other changes of behaviour and fixes. Each one says what changed and, when there is something to do, what to do. Without `--from` it starts at the newest
version tag. `naima announce` still decides which features an announcement may name.

## Credits

Release notes end with a Credits section: Naima itself, every plugin or stance the project loads from outside Naima, and every tool the loaded plugins install
or run, each with where it is published (its homepage and its source), who made it, its licence and the version in use. `naima changes` adds it as Markdown
after the changes, and `naima announce --gate <gate>` prints it after the features. To see it on its own:

```sh
naima credits             # as text
naima credits --markdown  # as the Credits section of release notes
naima credits --json      # one object for each credit
```

Each credit comes from an attribution its plugin declares: `name`, `homepage`, `source`, `authors`, `license` and `version`. The authors are named when there
are a few of them, and otherwise the team or organisation that makes it is named. A plugin or stance from outside Naima declares its own under `attribution` in
its manifest. A tool declares `source` and `authors` beside its `homepage`, `licence` and `version`. Anything a plugin runs without installing it, such as a
program it finds on the PATH, goes under `credits`. When an attribution is missing a field, `naima credits` says which one is missing.

This way of crediting is provisional: the fields and where they are declared may still change.

`naima announce --all` also lists every user-facing feature that isn't announceable yet, each with what it still lacks:

```console
1 user-facing, not announceable
  ✗ features/sharing  Sharing — not documented: set docs=<path>[#heading]
```

There are four things a feature can lack:

| Lacks       | Fix                                                                                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| user-facing | `facing=user`, if it is                                                                                                                                                                                  |
| shipped     | it is not on the main branch yet: nothing to announce                                                                                                                                                    |
| documented  | the page that documents it, named in `docs`                                                                                                                                                              |
| checked     | a [test item](glossary.md#test-item) that verifies it and has passed, run by a person (`runBy=human`) or by an agent driving the running software (`runBy=agent-hands`); a unit test alone is not enough |

## The README and the site

`naima check` fails when the README names a feature that isn't announceable, either by its label (`features/sharing`) or by its full title. To apply the same
check to the site's pages, list them in the option `copy`:

```json
"plugins": { "announce": { "options": { "copy": ["README.md", "site/index.html"] } } }
```

The agent that writes the announcements, and the things it refuses to write, are described in [the announcer](../agents/announcer.md). Every option is in the
[reference](../reference/reference.md).
