# Tools

When a verifier reports `tool missing:`, or a piece of work needs a model
checker on some machine, Naima installs the tool. Don't install it by hand.
That means no Homebrew, no apt, no download into the system and nothing added
to `PATH`.

1. Run `naima tools` (with `--host <h>` for another machine) to see what is
   installed, missing or unavailable there. An unavailable tool says why and
   what to do about it. Tell the owner, and don't try to work around it.
2. Run `naima tools show <tool>` to see the plan, which lists every tool it
   would install with its source, size and licence.
3. Show the owner that plan and ask. Install only if they say yes:
   `naima tools install <tool> --consent "<their yes, restated in your words>"
   --by <who>`. The consent is recorded in the receipt on that machine, and an
   install without it is refused. A single yes covers that plan on that
   machine, but not later installs.
4. The install checks the tool by running it. If that fails, nothing is left
   installed and the output says why (for example, a Linux that is too old
   for the build). Report it.

`naima tools path <tool> [<program>]` prints the path of an installed program
for use in a script (`naima tools path storm python`), and
`naima tools remove <tool>` removes a tool. The page for people is
[tools](../guide/tools.md).
