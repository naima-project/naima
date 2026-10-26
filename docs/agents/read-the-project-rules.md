# Read the project's rules

Every agent, coordinator or worker, runs this at the start of its work, before anything else:

```sh
naima rules --audience agents
```

It prints the project's own active rules for agents and for everyone, with `must` rules before `should` rules, each with its text and its reason. Follow them
for the whole session, on top of [the rules](../guide/rules.md) that every project holds to. `naima guide`, run inside the project, prints the same rules first
and then points at the documentation.

```sh
naima rules                  # every active rule, whatever its audience
naima rules --json           # as data: item, title, audience, strength, enforcedBy, ack, text
```

A rule is an [item](../guide/glossary.md#item) in the project's tracker, and a person writes it ([write a project rule](../guide/write-a-project-rule.md)). A
rule marked `enforcedBy` is also upheld by that check or [gate](../guide/glossary.md#gate). The others are kept by whoever reads them.

## Giving the acknowledgement back

When any active rule sets `ack`, the listing above ends with one more line:

```
Acknowledge: Quiet mode on · Simple mode on · Fast mode on
```

Give that line back exactly as printed in your first reply of the session. That's how the project checks that the rules were read and not only printed. A
session note (`naima pass --ack "<line>"`) carries it too, at the start, and is refused if a phrase is missing. Once acknowledgement lines are in use,
`naima check` expects every note written after that point to carry one. Anyone who reads a reply instead of running the command can check it the same way, on
any text, with `naima rules check-ack <file|->`.
