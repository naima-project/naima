# Git, handled for the owner

The [owner](../guide/glossary.md#owner) never has to learn git. Naima keeps everything in a git [repository](../guide/glossary.md#repository), so the agents
take care of git completely, in a simple and safe way that doesn't lose work. This page applies the rule
[git is the agent's job, done safely](../guide/rules.md#git-is-the-agents-job-done-safely).

## 1. Have git

Run `git --version`. If git is missing, install it with the system's own installer:

| System         | Command                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| macOS          | `xcode-select --install` (or `brew install git` where Homebrew is present) |
| Debian, Ubuntu | `sudo apt-get install -y git`                                              |
| Fedora         | `sudo dnf install -y git`                                                  |
| Windows        | `winget install --id Git.Git -e`                                           |

If the installer asks for the computer's password, you need the owner, since that is a `credential` and the only part that is theirs
([asking the human](asking-the-human.md)). Tell them in one line what is being installed and why.

## 2. Have a repository

If the project folder isn't a repository yet (`git rev-parse
--is-inside-work-tree` fails), create one:

```sh
git init
git config user.name    # empty? ask the owner once which name and email to sign work with
```

The name and email are the owner's to choose (`decision`). Ask once, set them with `git config user.name "…"` and `git config user.email "…"`, and don't ask
again.

## 3. Write a sensible `.gitignore` before the first commit

Anything that must never enter the repository has to be excluded before the first commit, because whatever is committed stays in the history:

- **Secrets**: `.env`, `.env.*`, `*.pem`, `*.key`, files named `credentials*` or `secrets*`, tokens, and any password.
- **Private or large data**: raw data with personal information, and large files the owner keeps elsewhere. Whether a data set is versioned is the owner's
  decision, and until they decide, leave it out.
- **What can be rebuilt**: dependencies (`node_modules/`, `.venv/`), build output (`dist/`, `build/`) and caches.
- **System clutter**: `.DS_Store`, `Thumbs.db` and editor folders.

Start from the standard ignore list for each language the project uses (the collection at https://github.com/github/gitignore is the usual source), and add the
project's own data folders. `naima init` writes its own `naima-tracker/.gitignore` and never touches the project's.

## 4. Use git so nothing is ever lost

- **Small commits, one idea each, with a message that says why.** Then any single change can be found and undone.
- **Look before committing.** Run `git status` and `git diff --cached` and make sure nothing from step 3 is staged and no secret appears in the diff.
  `naima check` (the check `secrets`) also reads every file for the common shapes of keys. If a secret has already been committed, tell the owner straight away
  rather than hiding it.
- **Never force-push, never rewrite history.** That means no `git push --force`, no `git rebase` of shared branches, no `git reset --hard` over someone's work,
  and no `git commit --amend` of a commit that has already been shared. To undo something, add a commit with `git revert <commit>`.
- **Work on a branch, in a worktree, per Naima's flows.** Use one [worktree](../guide/glossary.md#worktree) per piece of work
  ([opening a worktree](opening-a-worktree.md)). A branch is landed only once it is up to date with the main branch, as one merge commit that names what it
  closes ([closing a worktree](closing-a-worktree.md)), and nobody commits on the main branch while branches are being prepared
  ([worktree isolation](worktree-isolation.md)).
- **Push only where the owner has set a remote**, and only work that has passed its [gates](../guide/glossary.md#gate). If there is no remote, the work stays
  safely on the local machine.

## 5. Tell the owner nothing about git

The owner hears what changed in the work and what is needed from them, but not the git commands that did it. If there is a git problem the agents can't solve on
their own, such as a credential needed to push or a conflict between two people's work that needs a choice, bring it to the owner as one question in plain words
([asking the human](asking-the-human.md#when-you-do-ask)).

What a commit message itself has to say is covered by [its own contract](commit-messages.md).

## Safety rules

- **Never force-push, never rewrite shared history.** Convention: no `--force`, no `rebase` of a shared branch, no `reset --hard` over someone's work and no
  `commit --amend` of a commit that has been shared. Undo with `git revert` instead.
- **No secret is committed.** Enforced by the check `secrets`, which reads every file and attachment for the common shapes of keys before it lands.
- **Nothing is pushed where the owner set no remote.** Convention: without a remote, the work stays local, which is always safe.
