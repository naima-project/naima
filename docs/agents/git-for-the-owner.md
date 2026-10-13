# Git, handled for the owner

The [owner](../guide/glossary.md#owner) never has to learn git. Naima keeps
everything in a git [repository](../guide/glossary.md#repository), so the
agent takes git on entirely, in a simple, solid way that never loses work.
The rule this page applies:
[git is the agent's job, done safely](../guide/rules.md#git-is-the-agents-job-done-safely).

## 1. Have git

Run `git --version`. If it is missing, install it with the system's own
installer:

| System | Command |
|---|---|
| macOS | `xcode-select --install` (or `brew install git` where Homebrew is present) |
| Debian, Ubuntu | `sudo apt-get install -y git` |
| Fedora | `sudo dnf install -y git` |
| Windows | `winget install --id Git.Git -e` |

An installer that asks for the computer's password needs the owner: that is a
`credential`, the only part that is theirs
([asking the human](asking-the-human.md)). Say what is being installed and
why, in one line.

## 2. Have a repository

If the project folder is not a repository yet (`git rev-parse
--is-inside-work-tree` fails), start one:

```sh
git init
git config user.name    # empty? ask the owner once which name and email to sign work with
```

The name and email are the owner's to choose (`decision`); asked once, they
are set with `git config user.name "…"` and `git config user.email "…"`, and
never asked again.

## 3. Write a sensible `.gitignore` before the first commit

What must never enter the repository is excluded before anything is
committed, because what is committed stays in the history:

- **Secrets**: `.env`, `.env.*`, `*.pem`, `*.key`, files named
  `credentials*` or `secrets*`, tokens, any password.
- **Private or large data**: raw data with personal information, and large
  files the owner keeps elsewhere. Whether a data set is versioned is the
  owner's decision; until it is decided, exclude it.
- **What can be rebuilt**: dependencies (`node_modules/`, `.venv/`), build
  output (`dist/`, `build/`), caches.
- **System clutter**: `.DS_Store`, `Thumbs.db`, editor folders.

Start from the standard ignore list for each language the project uses (the
collection at https://github.com/github/gitignore is the usual source), and
add the project's own data folders. `naima init` writes its own
`naima-tracker/.gitignore`; it never touches the project's.

## 4. Use git so nothing is ever lost

- **Small commits, one idea each, with a message that says why.** Any single
  change can then be found and undone.
- **Look before committing.** `git status` and `git diff --cached`: nothing
  from step 3 is staged, no secret appears in the diff; `naima check` (the
  check `secrets`) reads every file for the common key shapes. A secret
  already committed is a problem for the owner to know about at once, not to
  hide.
- **Never force-push, never rewrite history.** No `git push --force`, no
  `git rebase` of shared branches, no `git reset --hard` over someone's work,
  no `git commit --amend` of a commit already shared. To undo, add a commit:
  `git revert <commit>`.
- **Work on a branch, in a worktree, per Naima's flows**: one
  [worktree](../guide/glossary.md#worktree) per piece of work
  ([opening a worktree](opening-a-worktree.md)), landed only once it is up to date
  with the main branch, as one merge commit naming what it closes
  ([closing a worktree](closing-a-worktree.md)), never a commit on the main
  branch while branches are being prepared
  ([worktree isolation](worktree-isolation.md)).
- **Push only where the owner has set a remote**, and only what passed its
  [gates](../guide/glossary.md#gate). With no remote, the work stays safely local.

## 5. Tell the owner nothing about git

The owner hears what changed in the work and what is needed from them, never
the git commands that did it. A git problem the agent cannot solve alone —
a credential to push, a conflict between two people's work that needs a
choice — is brought as one question in plain words
([asking the human](asking-the-human.md#when-you-do-ask)).

What a commit message itself must say is
[its own contract](commit-messages.md).

## Safety rules

- **Never force-push, never rewrite shared history.** Convention: no
  `--force`, `rebase` of a shared branch, `reset --hard` over someone's work,
  or `commit --amend` of a commit already shared; undo with `git revert`
  instead.
- **No secret is committed.** Enforced by the check `secrets`, which reads
  every file and attachment for the common key shapes before it lands.
- **Nothing is pushed where the owner set no remote.** Convention: with no
  remote, work stays local, which is always safe.
