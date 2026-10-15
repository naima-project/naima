# Tools: what a plugin needs, installed by Naima

A model checker such as mCRL2 or Storm is a separate program. The plugin
that uses it says which program it needs, at which exact version, and where
each platform gets it from. When you say yes, Naima installs it on the
machine it runs on, in a directory of its own. The agents do this for you,
and each command below is what they type, so you can check what they did. You
can also run the commands yourself if you want to.

## What this machine has

```sh
naima tools
```

```text
tools on this machine (darwin-arm64), in /Users/you/Library/Application Support/naima/tools:
  mcrl2    202607.0         installed  [verifier-mcrl2]
  python   3.13.16+20261003 missing — naima tools install python  [storm]
  storm    1.14.0           missing — naima tools install storm  [storm]
```

This lists every tool the project's plugins declare, each in one state:
`installed`, `missing` (with the command that installs it), `unavailable
here` (with the reason and what to do instead), or `no declaration for` this
platform. The command doesn't write anything. `naima tools --json` prints the
same information as data.

`naima tools show storm` prints what an install would fetch for the tool and
for every tool it needs, giving the source, the size, the sha256 and the
licence of each.

## Install one

```sh
naima tools install mcrl2
```

Naima prints the plan, with the source, the size and the licence, and asks
`Install? [y/N]`. It only goes on if the answer is `y`. An agent has no
terminal on which to ask, so it shows you the plan, asks you in chat, and
passes your answer with `--consent "<your yes, restated>" --by <you>`. The
yes, who gave it, how and when are all kept in the install's receipt.

Naima then downloads the file, checks that its size and sha256 match the
declared ones, unpacks it, and runs the tool once to see that it works on this
machine (for mCRL2, `mcrl22lps --version` must say `202607.0`). While it
downloads, it shows how many bytes it has out of the total, along with the
rate and the time left. If any step fails, nothing is kept. From then on, the
verifier that declared the tool uses it without needing anything on your
`PATH`.

## Where the tools go

| System | Directory |
|---|---|
| macOS | `~/Library/Application Support/naima/tools` |
| Linux | `$XDG_DATA_HOME/naima/tools`, by default `~/.local/share/naima/tools` |
| Windows | `%LOCALAPPDATA%\naima\tools` |

Setting `NAIMA_TOOLS` to an absolute path picks a different directory. There
is one directory per user and machine, shared by every project and every
worktree. Naima writes nothing anywhere else, so it doesn't touch your `PATH`,
your shell files or any system folder, and it doesn't need administrator
rights. Deleting the directory removes every tool and leaves the machine as
it was.

## Remove one

```sh
naima tools remove storm
```

This removes every version of the tool from the directory. If another
installed tool needs it, as Storm needs its Python, the removal is refused
until that other tool has been removed.

## The first tools

| Tool | Version | Plugin | macOS arm64 | macOS x86_64 | Linux x86_64 | Linux arm64 | Windows x86_64 |
|---|---|---|---|---|---|---|---|
| `mcrl2` | 202607.0 | `verifier-mcrl2` | yes | yes | yes, glibc 2.38 or later | no build published | yes |
| `storm` | stormpy 1.14.0 | `storm` | yes, macOS 14 or later | yes, macOS 15 or later | yes, glibc 2.34 or later | yes, glibc 2.34 or later | no build published |
| `python` | 3.13.16 | `storm` | yes | yes | yes | yes | yes |

- On Linux, mCRL2 comes from its `.deb` package, which is unpacked into the
  tools directory and never installed into the system.
- Storm is installed as its Python package, in a Python environment of its
  own, on a Python that Naima also installs. The system's Python is never
  used. `naima tools path storm python` prints the path of that Python, which
  can import `stormpy`, for use in your scripts. The `storm` plugin stays off
  until the project turns it on with `naima plugin enable storm`.
- Where a platform has no build, `naima tools` says so and tells you what to
  do instead, which is to run that work on another machine (see below).

## On another machine

```sh
naima tools --host lab
naima tools install mcrl2 --host lab
```

`--host` asks a machine declared for [long work](long-work.md#on-another-machine),
through that machine's own Naima, over ssh. An install there shows that
machine's plan and asks for your yes here, and the tool goes into that
machine's tools directory.

## For plugin authors

A plugin declares a tool under `contributes.tools`: `name`, `title`, `says`,
`version` (one exact version), `licence`, `homepage`, `needs`, `programs`,
`verify` (a program, its arguments, and what its output must contain), and
`platforms`. The `platforms` field has one entry for each of `darwin-arm64`,
`darwin-x64`, `linux-x64`, `linux-arm64` and `windows-x64`, and each entry is
either a source (`url`, `size`, `sha256`, `format`, which is one of `zip`,
`tar.gz`, `dmg`, `deb` or `pip`, and `bin`) or
`{ "unavailable": "<why, and what to do>" }`. If a declaration is missing any
of these, the project doesn't load, and the error names the plugin. The
plugin finds an installed program with `installedProgram(tool, program)` from
the plugin API.
The [reference](../reference/reference.md) lists every declared tool.
