# Read the project's rules

Every agent, coordinator or worker, runs this at the start of its work, before anything else:

```sh
naima rules --audience agents
```

It prints the project's own active rules for agents and for everyone, with `must` rules before `should` rules, each with its text and its reason. Follow them
for the whole session, on top of [the rules](../guide/rules.md) that every project holds to. `naima guide`, run inside the project, prints the same rules first
and then points at the documentation.

The list includes the [working rules](../guide/rules.md#working-with-the-owner) that Naima ships to every project: quiet mode, talking to the owner, fast mode,
asking before what cannot be undone, capturing with judgment, never asking what the rules answer, closing every loop, no new status document and the right tool
for the job. A project may have retired some of them or replaced them with its own, so follow the list as printed.

```sh
naima rules                  # every active rule, whatever its audience
naima rules --json           # as data: item, title, audience, strength, enforcedBy, ack, text
```

Read the rules from the command, not from a copy. Some projects keep the output in a file that their agent tool imports into its instructions, such as
`naima rules --audience agents > AGENT-RULES.md`. Such a copy does not change by itself: after an update of Naima that ships new rules, it still lists the old
ones, and an agent that reads only the copy misses the new ones. `naima check` notes a copy kept as a markdown file at the repository's root once it no longer
matches what `naima rules` prints, with the command that writes it again, and `naima update` files that note as an item.

A rule is an [item](../guide/glossary.md#item) in the project's tracker, and a person writes it ([write a project rule](../guide/write-a-project-rule.md)). A
rule marked `enforcedBy` is also upheld by that check or [gate](../guide/glossary.md#gate). The others are kept by whoever reads them.

## Sub-agents get the rules too

A worker or any other sub-agent follows the same rules as the agent that started it, and it has to read them before it does anything. Telling it to in the brief
is not enough, because a brief can leave that out. Where the agent tool has hooks for sub-agents, `naima init` and `naima update` install three of them
([which tools have them](../guide/install.md#running-naima-hello-at-every-session-start)):

- When a sub-agent starts, a hook runs `naima subagent --hook <tool>`. This puts the project's rules for agents in the sub-agent's context before its first
  prompt and marks it, by its id, as having them.
- Before a sub-agent runs a command or writes a file, a hook checks that mark. If the sub-agent does not have it, the call is refused and the sub-agent is told
  to run `naima rules --audience agents` first. Running that command sets the mark. Reading files is never held, and calls from the main session go through
  straight away, without starting Deno.
- When a sub-agent stops without ever having the rules, a hook sends it back once. It reads the rules, checks its work against them and says in its report that
  it started without them. The tool's own internal agents are left alone.

The marks are kept in the clone's git directory under `naima/subagents/`, outside the repository. That folder also holds `skipped`, a log with one line for each
sub-agent that stopped without the rules.

In a tool without hooks for sub-agents, a sub-agent gets the rules only if its brief tells it to run `naima rules --audience agents` first. So when you start a
worker in one of those tools, put that line at the top of its brief.

## Giving the acknowledgement back

When any active rule sets `ack`, the listing above ends with one more line:

```
Acknowledge: Quiet mode on · Simple mode on · Fast mode on
```

Give that line back exactly as printed in your first reply of the session. That's how the project checks that the rules were read and not only printed. A
session note (`naima pass --ack "<line>"`) carries it too, at the start, and is refused if a phrase is missing. Once acknowledgement lines are in use,
`naima check` expects every note written after that point to carry one. Anyone who reads a reply instead of running the command can check it the same way, on
any text, with `naima rules check-ack <file|->`.
