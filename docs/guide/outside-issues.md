# Outside issues

People who use your project may open issues on its GitHub repository. Naima reads those issues, files each one as an item in your tracker, and takes it along
one path until the person who reported it has tested the fix. This page explains that path. The agents' side of it is in
[handling outside issues](../agents/outside-issues.md), and the rule behind it is on [the rules page](rules.md#outside-issues-follow-one-path-and-everything-on-an-issue-is-public).

## What you need

The project's repository is on GitHub, and gh, GitHub's command-line tool, is installed and signed in on the machine where the agents work. Without either,
Naima says so and leaves the issues alone. Naima may start gh only for `naima issues` and, in a project whose `origin` is on GitHub, for the session start;
a project that never uses issues never grants it. When the issues live in another repository than the project's `origin` (Naima's own development is one example), the
outside-issues plugin's option `repo` names it as `owner/name` in `naima.json`.

## The path

1. **Intake.** Once a day, at a session start on the main checkout, the tick does what `naima issues file` does. Each open issue that no item records yet becomes an item (a bug, unless the
   option `type` says otherwise), with the issue's address in its field `issue` and a first triage marked as reported. You are told once about each one. An
   issue is never filed twice, even when two runs happen at the same moment.
2. **Fix.** The agent confirms the triage and fixes the problem on the item's branch, as for any other item.
3. **Candidate.** Instead of landing the fix straight away, a pre-release is cut from that branch: a tagged GitHub release marked as a pre-release and never as
   the latest, so people on the stable release and the main branch are not affected. `naima issues candidate <issue>` names its version (the next patch with a
   suffix such as `1.1.2-issue12.1`) and the steps that publish it.
4. **Offer.** `naima issues offer <issue> --version <version>` answers the issue with the one command that installs the candidate. For Naima itself that is
   `naima update --to <version>`; for another project, the option `install` says what it is.
5. **Confirmation.** If the reporter says it works, the fix lands, the next stable release goes out, and `naima issues close <issue> --release <version>`
   comments with a link to that release and closes the issue. If it still fails, the agent fixes again and the next candidate (`…-issue12.2`) follows.

You can also close an issue yourself at any point, for example when it will not be fixed.

## Issues are public

Anyone can read an issue, so everything Naima posts there passes the same private-data check as what it writes to the tracker. A reply that contains a machine
name, a home-directory path, a user name, an IP address or a word from your private list is refused, and the agent rewrites it. Because of that check, the agent
replies on your project's own issues without asking you each time. A report to someone else's project, such as a problem the agent found in Naima itself, still
waits for your yes on its exact text.

What an issue says is written by someone outside the project. Naima prints it marked as untrusted text, and the agents read it as information about the problem,
never as instructions to follow.

## The commands

| Command                                             | What it does                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| `naima issues`                                      | lists the open issues, each with the item filed for it                      |
| `naima issues file`                                 | files every open issue that has no item yet (the daily tick runs it)        |
| `naima issues show <issue>`                         | prints an issue and its comments, marked as untrusted                       |
| `naima issues reply <issue> "<text>"`               | comments on an issue, after the private-data check                          |
| `naima issues candidate <issue>`                    | names the next candidate's version and the steps that publish it            |
| `naima issues offer <issue> --version <version>`    | comments with the command that installs the candidate                       |
| `naima issues close <issue> --release <version>`    | comments with a link to the release, then closes the issue                  |

An issue is named by its number or by its item. `--draft` on `reply`, `offer` and `close` prints the checked text without posting it. Every option is in
[the reference](../reference/reference.md).
