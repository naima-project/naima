# Naima

**Website: [naima-project.github.io/naima](https://naima-project.github.io/naima/)**

Naima is a silent software house of AI agents that turns vibe coding into an
exact science — born for software, it manages any project.

## Install

In the root of a git repository, one line:

```sh
curl -fsSL https://naima-project.github.io/naima/install.sh | sh     # macOS, Linux
irm https://naima-project.github.io/naima/install.ps1 | iex          # Windows PowerShell
```

Or ask your agent:

> Please install https://github.com/naima-project/naima in this repository.

The installer sets up [Deno](https://deno.com) when it is missing, clones
Naima into `naima-tracker/naima/` and checks it.

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
$BinDir = "$Home\.deno\bin"
$Version = curl.exe --ssl-revoke-best-effort -s "https://dl.deno.land/release-latest.txt"
New-Item $BinDir -ItemType Directory -Force | Out-Null
curl.exe --ssl-revoke-best-effort -Lo "$BinDir\deno.zip" "https://dl.deno.land/release/$Version/deno-x86_64-pc-windows-msvc.zip"
tar.exe xf "$BinDir\deno.zip" -C $BinDir
Remove-Item "$BinDir\deno.zip"
$Path = [Environment]::GetEnvironmentVariable('Path', 'User')
[Environment]::SetEnvironmentVariable('Path', "$Path;$BinDir", 'User')
$Env:Path += ";$BinDir"
```

**Check it**, in a new terminal:

```sh
deno --version
```

It prints `deno 2.x.y` and the versions of V8 and TypeScript. If it says
`command not found`, the new `PATH` is not read yet: open a new terminal, or
run `~/.deno/bin/deno --version` (`& "$Home\.deno\bin\deno.exe" --version` on
Windows) to see that Deno itself works. To check the download before
unpacking it, compare its sha256 — `shasum -a 256 ~/.deno/bin/deno.zip` on
macOS and Linux, `Get-FileHash $BinDir\deno.zip` on Windows — with the one in
`https://dl.deno.land/release/<version>/deno-<target>.zip.sha256sum`.

## What you get

- **You say what you want, agents build it**, with written requirements,
  tests, reviews and gates before anything ships.
- **Every claim comes with its evidence**: nothing counts as done until it is
  shown to be.
- **Formal methods applied for you**: properties of the design proven by
  tools, without your needing to know them.
- **Code-quality metrics per commit** — complexity, duplication, coverage —
  beside the tests, in a native window with `naima ui`.
- **A tracker in your repository**, plain files under git: items, decisions,
  plans and their proofs, managed for you.
- **Any project, not only software**: a data analysis checked by reproducible
  runs, a paper checked by reviews.

You don't need to know git, code or project management. You need an AI agent.

## Documentation

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
