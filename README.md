# Naima

**Website: [naima-project.github.io/naima](https://naima-project.github.io/naima/)**

Naima is for people who build software by asking an AI, and want what they
built to keep working. You keep using the AI you already have. Naima gives it
a way of working: it writes down what you asked for, tests every change before
calling it done, remembers what was decided from one session to the next, and
asks you only the questions that are yours to answer.

It is free and open source, with no account and no server. It lives in a
folder of your project, as plain files kept in git, and it works for programs,
data analyses and papers alike.

Naima is in beta while version 1.1 is stabilized for its first public release.

## What you get

- **You say what you want, and agents build it**, with written requirements,
  tests and reviews before anything ships.
- **Nothing counts as done until a test shows it works.** When a fix breaks
  something that used to work, the tests catch it, and the agent can't close
  the work without a passing proof.
- **The project remembers.** Decisions, open problems and what each session
  did are kept as files, so the next session starts where the last one
  stopped and doesn't ask you the same question twice.
- **Formal methods where they help**: properties of the design checked by a
  model checker, without your needing to know how it works.
- **Code-quality measures on every commit** (complexity, duplication,
  coverage) recorded beside the tests.
- **Not only software**: a data analysis checked by reproducible runs, a paper
  checked by reviews.

You don't need to know git, code or project management. You need an AI agent
that can run commands in your project's folder, such as the Code tab of the
Claude desktop app, Claude Code, Codex or Cursor. Chat-only assistants and
browser app builders can't install it.

## Install

Open your AI agent in your project's folder, or in a new empty one, and ask
it:

> Please install https://github.com/naima-project/naima in the root of this repository; create a repository at the root if missing.

The agent sets up what is needed. If you prefer to run the installer yourself, it is one line in the
root of a git repository:

```sh
curl -fsSL https://naima-project.github.io/naima/install.sh | sh     # macOS, Linux
irm https://naima-project.github.io/naima/install.ps1 | iex          # Windows PowerShell
```

The installer sets up [Deno](https://deno.com), the one program Naima runs on,
when it is missing. It clones Naima into `naima-tracker/naima/`, writes the
rest of `naima-tracker/` and a line in your agent's instruction file, and
changes nothing else in your project. It needs no administrator rights.

The tracker, `naima-tracker/naima-data/`, is committed with the code when the
repository has no remote or a private one. When the remote is public, or its
visibility can't be told, the installer stops and asks (through your agent)
whether to keep the tracker private beside the code, recommending yes: run it
again with `NAIMA_TRACKER=private` for a git repository of its own, on this
machine only and ignored by the code, or `NAIMA_TRACKER=inside` to commit it
with the code anyway
([keep the tracker private](docs/guide/private-tracker.md)).

### Deno by hand

Naima runs on Deno, one program. To install it yourself, for your user only
and without administrator rights, do what Deno's own installers
(`deno.land/install.sh`, `deno.land/install.ps1`) do: download the zip of the
latest release into `~/.deno/bin`, unpack it there, and put that folder on
your `PATH`.

**macOS and Linux**, in a terminal. Pick the line for your machine, then run
the rest (`unzip` is needed; `sudo apt install unzip` on Debian or Ubuntu if
it is missing):

```sh
target=aarch64-apple-darwin          # macOS, Apple silicon (M1 and later)
target=x86_64-apple-darwin           # macOS, Intel
target=x86_64-unknown-linux-gnu      # Linux, x86_64
target=aarch64-unknown-linux-gnu     # Linux, arm64

version="$(curl -s https://dl.deno.land/release-latest.txt)"
mkdir -p "$HOME/.deno/bin"
curl --fail --location --output "$HOME/.deno/bin/deno.zip" "https://dl.deno.land/release/$version/deno-$target.zip"
expected="$(curl --fail --silent "https://dl.deno.land/release/$version/deno-$target.zip.sha256sum" | grep -Eo '[0-9a-fA-F]{64}' | head -n 1 | tr 'A-F' 'a-f')"
actual="$( (shasum -a 256 "$HOME/.deno/bin/deno.zip" 2>/dev/null || sha256sum "$HOME/.deno/bin/deno.zip") | cut -d ' ' -f 1)"
[ -n "$expected" ] && [ "$expected" = "$actual" ] || { echo "deno.zip does not match its published sha256: stopping" >&2; rm -f "$HOME/.deno/bin/deno.zip"; exit 1; }
unzip -d "$HOME/.deno/bin" -o "$HOME/.deno/bin/deno.zip"
chmod +x "$HOME/.deno/bin/deno"
rm "$HOME/.deno/bin/deno.zip"
```

Then add this line to your shell's startup file — `~/.zshrc` on macOS,
`~/.bashrc` on most Linux systems — and open a new terminal:

```sh
export PATH="$HOME/.deno/bin:$PATH"
```

(The installer writes the same line into `~/.deno/env` and adds
`. "$HOME/.deno/env"` to `~/.profile`, `~/.bashrc` and `~/.zshrc`.)

**Windows**, in PowerShell (Windows 10 version 1709 or later, which ships
`curl.exe` and `tar.exe`). The installer always takes the x86_64 build, which
Windows on ARM runs emulated:

```powershell
$ErrorActionPreference = 'Stop'
$BinDir = "$Home\.deno\bin"
$Version = curl.exe --ssl-revoke-best-effort -s "https://dl.deno.land/release-latest.txt"
$Zip = "deno-x86_64-pc-windows-msvc.zip"
New-Item $BinDir -ItemType Directory -Force | Out-Null
curl.exe --ssl-revoke-best-effort -Lo "$BinDir\deno.zip" "https://dl.deno.land/release/$Version/$Zip"
$Expected = ((curl.exe --ssl-revoke-best-effort -s "https://dl.deno.land/release/$Version/$Zip.sha256sum") -join ' ' |
  Select-String -Pattern '[0-9A-Fa-f]{64}').Matches[0].Value
if ((Get-FileHash "$BinDir\deno.zip" -Algorithm SHA256).Hash -ne $Expected) {
  Remove-Item "$BinDir\deno.zip"
  throw "deno.zip does not match its published sha256: stopping"
}
tar.exe xf "$BinDir\deno.zip" -C $BinDir
Remove-Item "$BinDir\deno.zip"
$Path = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($Path -split ';') -notcontains $BinDir) {
  [Environment]::SetEnvironmentVariable('Path', "$Path;$BinDir", 'User')
}
if (($Env:Path -split ';') -notcontains $BinDir) { $Env:Path += ";$BinDir" }
```

Saved as a `.ps1` file and run rather than pasted, the script needs
`powershell -ExecutionPolicy Bypass -File <file>`. Run twice, it adds nothing
to the `PATH` the second time.

**Check it**, in a new terminal:

```sh
deno --version
```

It prints `deno 2.x.y` and the versions of V8 and TypeScript. If it says
`command not found`, the new `PATH` is not read yet: open a new terminal, or
run `~/.deno/bin/deno --version` (`& "$Home\.deno\bin\deno.exe" --version` on
Windows) to see that Deno itself works. The steps above already compare the download with the sha256 Deno publishes in
`https://dl.deno.land/release/<version>/deno-<target>.zip.sha256sum` before
unpacking it, and stop if they differ.

## Documentation

- [Naima in one minute](docs/guide/naima-in-one-minute.md), then
  [Naima in ten minutes](docs/guide/naima-in-ten-minutes.md): what it does,
  from the everyday parts to the advanced ones.
- [The primer](docs/guide/primer.md): every concept of Naima, in the order
  you meet it.
- [The documentation](docs/README.md), starting with
  [installing and updating](docs/guide/install.md).
- For agents: [the skill](skills/naima/SKILL.md).
- Contributing: Naima is built and tested in its workshop,
  [naima-project/naima-lab](https://github.com/naima-project/naima-lab),
  which holds the tests, the site and the scripts; start from its
  [CONTRIBUTING.md](https://github.com/naima-project/naima-lab/blob/main/CONTRIBUTING.md).

## Licence

Apache License 2.0: [LICENSE](LICENSE), [NOTICE](NOTICE).
