# Write a project rule

A project's own rules cover things like how an agent works here (quiet,
simple or fast modes), how it reports, and what it asks before acting. They
are [items](glossary.md#item) in the project's tracker, kept in
`naima-tracker/naima-data/rules/`. Every project has its own, and Naima shows
them to whoever starts work there. The rules that every project holds to are
on [the rules page](rules.md), and this page is about the ones only your
project has. As elsewhere in the guide, the agents run these commands for you
unless you'd rather run them yourself.

## One rule, one item

```sh
naima new rules "Ask before deleting" --set audience=agents --set strength=must
```

Then write its page, `rules/ask-before-deleting/README.md`. It states the
rule clearly enough that it can be followed without asking, and says why the
rule exists.

```markdown
# Ask before deleting

Ask first before deleting data or items, force-pushing, or discarding
someone's uncommitted work.

Why: what cannot be undone is the owner's decision.
```

| Field | Values |
|---|---|
| `audience` | `agents`, `people`, `everyone` |
| `strength` | `must` (always), `should` (unless there is a reason, given where the work is recorded) |
| `enforcedBy` | optional: the name of the check or [gate](glossary.md#gate) that holds the rule |
| `ack` | optional: the exact phrase an agent gives back to acknowledge the rule; if it's unset, none is asked for |

A rule that sets `ack` is checked, not only read. `naima rules` and
`naima guide` print the phrases of all active rules, joined in order, as the
one line an agent must give back (`Acknowledge: Quiet mode on · Fast mode on`).
A session note written with `naima pass --ack "<line>"` is refused unless
every phrase is in it, and `naima check` flags a note that is dated after the
acknowledgement line came into use and doesn't carry it. A coordinator can
check a worker's reply, or any other text, the same way with
`naima rules check-ack <file|->`.

## Retiring a rule

A rule starts out `active`. When it is no longer in force it becomes
`retired` (`naima set <rule> status=retired`), and its page says what
replaced it. It stays in the tracker as history but isn't shown anywhere.
Because a rule isn't work, no board of open work lists it.

## Ready-made templates

A few lessons come up again and again across projects: a predicate checked in
two places, a "do not restore" comment nobody acts on, user data written into
a file the next update overwrites, a cache keyed by an id that nothing ever
cleans up, and in-product migration code kept forever for a format no release
still produces. The optional `rule-templates` plugin ships one rule for each
of these, ready to write as your own:

```json
"plugins": { "rule-templates": {} }
```

```sh
naima rule-templates                    # list what it ships, each with its id
naima rule-templates add one-predicate  # writes it as an ordinary rules item
```

`add` writes exactly the kind of item described above, with
`audience: agents`, and you can edit its text, fields or status like any rule
you wrote yourself. Turning the plugin on doesn't add anything by itself. A
template only becomes a rule when you ask for it.

## What `naima check` holds

The check fails on an active rule that has no text (an empty page, or the
template's own text), that has no audience or one it doesn't know, or whose
`enforcedBy` names no existing check or gate. Every field and the check
itself are listed in the [reference](../reference/reference.md#rules).

How the agents read these rules is described in
[read the project's rules](../agents/read-the-project-rules.md).
