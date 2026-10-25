# Questions

These are the questions people ask most often. For an overview of how Naima works, read [the primer](primer.md).

## Do I need to read or write code to use Naima?

No, and you don't need to know git or project management either. An AI agent runs the `naima` commands and git for you. You say what you want in plain words and
make the decisions that are yours to make ([working with AI agents](working-with-agents.md)). If you prefer, everything in [the guide](README.md) can also be
done by hand, with `naima` commands and plain text on an [item](glossary.md#item)'s page.

## Which AI agent do I need?

One that can run commands in your project's folder, because that is how it installs Naima and works with it. The Code tab of the Claude desktop app, Claude
Code, Codex and Cursor all can. A chat window that only answers in text can't, and neither can an app builder that runs in the browser, though a project you
started in one of those can be brought into a folder and continued with an agent once it is on GitHub. Naima isn't tied to any one agent or model, so you can
change agent later without losing anything.

## What does installing Naima change in my project?

It adds one folder, `naima-tracker/`, and one line in the file your agent reads at the start of each session (`AGENTS.md`, `CLAUDE.md` or similar), which tells
the agent to run `naima hello`. Nothing else in your project is touched. Inside that folder, `naima-tracker/naima/` holds the program and is ignored by git,
while `naima-tracker/naima-data/` holds your items and is committed like any other file, so every change Naima makes can be seen and undone. For a project that
looks public, the agent first asks whether to keep the tracker private: then `naima-tracker/naima-data/` is a separate local git repository that your project
ignores, and only a small file, `naima-tracker/tracker.json`, is committed with your code ([a private tracker](private-tracker.md)). If
[Deno](https://deno.com), the one program Naima runs on, is missing, the installer sets it up for your user, without administrator rights
([install](install.md)).

## Does Naima use more of my AI plan?

Usually yes. Writing a test that fails before a fix and passes after it, recording what was decided, and having a second agent check the work all take more
steps than a quick "fixed", and each step uses some of your agent's allowance. What you get for it is work that is shown to be done and a project that
remembers. On a plan with tight limits, ask the agent to keep to one piece of work at a time.

## Is Naima only for software?

No. It works for anything that benefits from keeping every version, such as software, a scientific data analysis, a paper written with colleagues, or several of
these at once in one project. Today's item types are shaped for software, but a bug such as "figure 3 uses last year's data" already fits them. Packs of item
types for other kinds of work are [planned](../planned.md#item-types-for-other-work).

## Is there a web page with the board?

No, because Naima has no server and no account. The board is `naima board <type>`, and `naima summary --markdown` prints the state of the project as markdown
you can paste anywhere. A window on your machine with the summary, the gates and the boards is [planned](../planned.md#design-skills-and-a-dashboard).

## Where is my data? Does anything leave my machine?

Your data is in `naima-tracker/naima-data/`, as plain files in your repository, committed along with your work. What you say to an agent in chat isn't copied
there unless you agree ([the rule](rules.md#the-owners-chat-stays-private)). Naima itself never uses the network. Git does, but only to fetch Naima when it is
first installed or updated ([the permissions](install.md#the-permissions)).

## Can I edit the files by hand?

You can edit an item's page (`README.md`) and its `attachments/` by hand, and that is how they are meant to be written. Its fields, in `meta.json`, should not
be edited by hand. Use `naima set`, `naima link` and the other commands instead ([the rule](rules.md#change-the-tracker-only-through-the-cli)). The
configuration, `naima.json`, can be edited by hand ([configure the project](configure-the-project.md)).

## Why won't Naima close my item?

To close an item, Naima needs the fix and a [proof](glossary.md#proof) that has passed. `naima close` tells you which one is missing, and
[prove and close](prove-and-close.md#5-close-it) lists every possible reason.

## Why does `naima check` fail after I pulled?

It is usually one of these:

- Someone updated Naima and your branch has items in the old format (this is the check `one-format`). Merge the [trunk](glossary.md#trunk) and run
  `naima update` ([update Naima](update-naima.md#on-a-branch-opened-before-the-update)).
- `naima.json` now names a different source. Find out why, and then run `naima update --accept-source`.
- There is a real problem in the data. The error line says which item, and what is wrong.

## "Fixed" and "closed" — what is the difference?

Fixed means the code exists. Resolved means it is fixed and proven. Closed means it is resolved and archived. These are three separate states, each with its own
count, and the counts are never added together ([concepts](concepts.md#fixed-resolved-closed)).

## The program folder appeared in my repository. Is that right?

Yes. `naima-tracker/naima/` is the copy of Naima that your project runs. Git ignores it, so `git status` never shows it. Some tools that don't respect
`.gitignore` may still read it, and [keep Naima out of your own tools](configure-the-project.md#keep-naima-out-of-your-own-tools) explains how to stop that.

## Who updates Naima?

Whoever runs `naima update` does, in a single commit. Usually that is an agent at the start of a session. Nothing updates on its own
([update Naima](update-naima.md)).

## Can two people, or two agents, work at once?

Yes. Each one works on its own branch and [worktree](glossary.md#worktree). Claims and [session notes](glossary.md#session-note) are files that belong to each
branch, so nobody edits the same file ([work on several branches at once](several-branches.md)).

## Does it work on Windows?

It installs and runs on Windows (`install.ps1`), but Naima's automated tests only run on Linux and macOS.

## How do I stop using Naima?

Delete `naima-tracker/` and commit. Nothing else in the project was changed, unless you asked `naima init --write-excludes` to add its exclusion lines to your
tool configurations, in which case remove those too.

## Can I change Naima itself?

Yes, and you're encouraged to. Do it in your own copy of its repository (a [fork](glossary.md#fork)), and never inside `naima-tracker/naima/`
([modifying Naima](install.md#modifying-naima)).

## A word I do not know

Every term is defined in the [glossary](glossary.md).
