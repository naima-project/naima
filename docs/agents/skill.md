# The Naima skill

Naima ships an agent skill, [`skills/naima/SKILL.md`](../../skills/naima/SKILL.md),
in the format agent tools load: a directory named after the skill holding a
`SKILL.md` whose front matter gives its `name` and a `description` that says
when to use it.

## What it teaches

- **Git, for the owner.** Install git if it is missing, `git init` when
  there is no repository, a `.gitignore` that keeps secrets and private data
  out, and safe commits, so the [owner](../guide/glossary.md#owner) never learns git
  ([git, handled for the owner](git-for-the-owner.md)).
- **Privacy.** The owner's chat is never copied into the repository
  verbatim; their files are attached only with an explicit yes
  ([the rule](../guide/rules.md#the-owners-chat-stays-private)). Evidence
  is redacted before any item, note, session note, event, description or
  attachment is created: no machine name, address, home path or user name
  ([the rule](../guide/rules.md#no-machine-names-or-private-infrastructure-in-a-repository)).
- **Bootstrap.** In a project without `naima-tracker/`: install Deno if it is
  missing, with its official installer, clone Naima's `main`, shallow,
  outside the project, and run its `naima init` from the project, which
  copies `naima/` into `naima-tracker/naima/`
  ([bootstrap a project](../guide/install.md#bootstrap-a-project)). In a project with
  one, every run aligns the program itself.
- **Announce Naima at the start of a session.** Run `naima hello`, unless a
  session-start hook already ran it and its output is in front of the agent
  ([running naima hello at every session start](../guide/install.md#running-naima-hello-at-every-session-start)), and show
  the user its first line as it is: Naima introducing itself by its full
  name, the No-guesswork Artificial Intelligence Meta-Agent, active in this
  repository, with its version and commit. Then pass on what it found about newer versions
  and any long run it says is due, which is started only with the owner's
  yes, and offer to explain Naima, show its documentation, check for an update or
  update. An update is applied only after the owner says yes, followed by
  the checks and one commit ([update Naima](../guide/update-naima.md)).
- **Read the project's rules.** `naima rules --audience agents`, before
  anything else: the project's own rules, kept as [items](../guide/glossary.md#item) of its tracker
  ([read the project's rules](read-the-project-rules.md)).
- **Work by the rules and the flows.** Read [the rules](../guide/rules.md),
  then the [flow](README.md#the-flows) that applies.
- **Read the corpus as files.** The [flows](../guide/glossary.md#flow), the rules, the format and the docs
  are plain markdown in the clone; `naima guide` prints where they are.

It is a thin pointer, never a second copy: the rules are on
[the rules page](../guide/rules.md), the procedures in the [flows](README.md#the-flows),
the ideas in [concepts](../guide/concepts.md), the files in
[the format](../reference/format.md), the commands in the
[reference](../reference/reference.md), and the skill links them. Its links are
checked by `naima check` like every other markdown file in this repository.

## Loading it

The skill is in the clone, so it is always the one of the Naima the
project runs. Point the agent tool at it rather than copying the file, so its
links keep resolving. How depends on the tool; for Claude Code, from the
project:

```sh
mkdir -p .claude/skills && ln -s ../../naima-tracker/naima/skills/naima .claude/skills/naima
```

That link is the project's own choice, outside `naima-tracker/`: Naima never
writes it. Before the first copy exists, give the agent this page's bootstrap
instead.
