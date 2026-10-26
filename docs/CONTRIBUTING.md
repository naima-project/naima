# Contributing to Naima

Anyone can report a problem with Naima, ask for a feature or send a fix, person or agent. Everything goes to the public repository,
[github.com/naima-project/naima](https://github.com/naima-project/naima), as an issue or a pull request.

Agents read this page live, from the repository's `main` ([raw](https://raw.githubusercontent.com/naima-project/naima/main/docs/CONTRIBUTING.md)), not from the
copy in `naima-tracker/naima/`, so it can change without a Naima update. If it cannot be fetched, the local copy is the fallback.

## Before sending anything

- **The owner says yes first.** An agent drafts the issue or the pull request, shows the owner the exact text, and sends it only after the owner agrees. Sending
  it publishes it.
- **Redact it.** Nothing from the owner's chat, and no machine name, IP address, home-directory path, user name, secret or private project detail, as in
  [the rules](guide/rules.md#no-machine-names-or-private-infrastructure-in-a-repository). Never paste a tracker item, a session note or an attachment of a
  private project.
- **Search first.** Look at the open [issues](https://github.com/naima-project/naima/issues) and [pull requests](https://github.com/naima-project/naima/pulls);
  comment on an existing one instead of opening a second.

## Reporting a problem

Open an issue with:

- the Naima version and commit, as `naima hello` prints them, and the operating system;
- the command run and what it printed, redacted, cut to the lines that show the problem;
- what was expected instead;
- the smallest steps that reproduce it, in a fresh project if possible.

## Asking for a feature

Open an issue that says what the owner needs and why, in a sentence or two, and how anyone could tell it works once it exists. Check [planned](planned.md)
first: it may already be on the way.

## Sending a fix

1. Fork the repository and branch from `main`. Never change `naima-tracker/naima/` in place: work in a separate clone
   ([modifying Naima](guide/install.md#modifying-naima)).
2. Keep the change small and on one subject. Include the test that shows it works, and update the documentation the change touches.
3. Open the pull request against `main`, saying what it changes and why, and link the issue it answers.

Naima is built and tested in a private workshop. An accepted pull request is checked there by the same tests as any other change, privately, before anything
reaches the public `main`; it may land as a commit of the maintainers rather than as a merge of the pull request.

With the GitHub CLI, an agent opens either one with `gh issue create
--repo naima-project/naima` or `gh pr create --repo naima-project/naima`; without it, the
owner opens the pages above with the drafted text.

## Licence

Contributions are made under the [Apache License 2.0](../LICENSE): by opening a pull request you agree to license your contribution under it.
