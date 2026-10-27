# Commands that run without a prompt

An agent tool asks the owner before it runs a command it judges risky. Each such prompt stops the owner, often for a command that was harmless, and an owner who
is asked too often starts to allow everything. Write commands the tool can see are safe, so it never needs to ask. What follows is what such tools look for, and
the same habits suit every tool.

## Deleting

- Never `rm` a path built from a variable that could be empty: `rm -r "$DIR/$name"` becomes `rm -r /` when both are empty. Name the path literally, or make the
  shell stop on an empty variable: `rm -r "${DIR:?}/${name:?}"`.
- Prefer the command made for the deletion: `git rm -r <path>` for tracked files, `naima run clean <name>` for what a run created, `naima prune` for branches
  and worktrees. A deletion of data or items still waits for the owner's yes ([the rule](../guide/rules.md#ask-before-what-cannot-be-undone)).
- Never `rm -rf` outside the project or the session's scratch directory.

## One command, one place

- Don't chain `cd` with other commands (`cd dir && make`): give paths instead, `git -C <dir> …`, `deno task --cwd <dir> …`, or the tool's own working directory.
- Keep a command to one job. A long chain of `;`, `&&` and pipes mixing reads, writes and deletions is hard for a tool to judge and is flagged as a whole.
- Don't build a command from text at run time: no `eval`, no `sh -c "$var"`, no pipe from a download into a shell.

## Scripts

- A script longer than a line or two goes in a file in the session's scratch directory and runs with its interpreter: `python3 <file>`, `sh <file>`,
  `deno run <file>`. An inline heredoc that also deletes or moves files is flagged with everything around it.
- Read files with the tool's own reading tool, and edit them with its editing tool, rather than with `cat`, `sed -i` or `awk` in a shell.

## Writing

- Write only inside the project and the session's scratch directory. Temporary data goes under `naima-tracker/.tmp/` or the scratch directory, never in the home
  directory or system folders.
- Redirect long output to a file there and read the excerpt ([quiet mode](../guide/rules.md#quiet-mode)).

## Git

- No force-push, no history rewriting, no `git reset --hard`, no `git clean -fd` on work that is not yours: each asks the owner, and the owner's yes is needed
  anyway.
- Work lands with `naima land`, so the trunk is never touched by a hand-made merge ([the rule](../guide/rules.md#every-change-goes-through-an-item-and-lands)).
