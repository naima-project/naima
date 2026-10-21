# Install Naima in the git repository you are standing in (Windows PowerShell).
#
#   irm https://vincenzoml.github.io/naima/install.ps1 | iex
#
# It clones Naima into naima-tracker\naima\ (a branch or a tag, no temporary
# clone), and runs its `naima init`: that records the
# clone's origin and commit in naima-tracker\naima-data\naima.json, beside it,
# writes the tracker folder's README.md and .gitignore, and points the
# project's agent file at Naima's own, saying to run naima hello at the start
# of every session, with a session-start hook for each agent tool in use that
# has one. Then it runs `naima check`. Nothing is
# installed globally for Naima; Deno, the one thing Naima needs on the
# machine, is installed with its official installer when it is missing. Run
# again, it says Naima is installed and checks it, cloning the program again
# first when it is missing (at the locked commit, if the clone that holds it
# is gone). On a host installed before the program was a git clone — a copy
# (naima\.naima-copy.json) or a clone of the old full repository (its HEAD
# holds naima\src\cli.ts) — it is moved aside to
# naima-tracker\.naima-legacy-<date>, never overwritten, the product is
# cloned fresh, and `naima update` moves the lock to its head and migrates the
# data; the one commit to make is printed. What it does by hand:
# naima/docs/guide/install.md#bootstrap-a-project.
#
#   NAIMA_SOURCE           the repository to clone (default: Naima's on GitHub)
#   NAIMA_REF              the branch or tag to install (default: main)
#   NAIMA_NO_DENO_INSTALL  when set, never install Deno: say how, and stop
#
# Run with `irm | iex` it runs in your session, so it never calls `exit`: a
# refusal is an error, and your window stays open.

function Install-Naima {
  $ErrorActionPreference = 'Stop'
  $Source = if ($env:NAIMA_SOURCE) { $env:NAIMA_SOURCE } else { 'https://github.com/vincenzoml/naima.git' }
  $Ref = if ($env:NAIMA_REF) { $env:NAIMA_REF } else { 'main' }
  $Program = 'naima-tracker/naima'
  $Lock = 'naima-tracker/naima-data/naima.json'

  function Say($m) { Write-Host "naima: $m" }
  function Invoke-Checked($exe, [string[]]$argv) {
    & $exe @argv
    if ($LASTEXITCODE -ne 0) { throw "naima: '$exe $($argv -join ' ')' failed (exit $LASTEXITCODE)" }
  }

  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'naima: git is missing: install it (winget install --id Git.Git -e), open a new terminal, and run this again'
  }
  # Windows PowerShell 5.1 turns a native command's redirected stderr into an error under 'Stop'.
  $ErrorActionPreference = 'Continue'
  $Root = & git rev-parse --show-toplevel 2>$null
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0 -or -not $Root) {
    throw 'naima: this is not a git repository. Is this the root of your project? If so, ask your agent to create a repository here and install Naima from https://vincenzoml.github.io/naima/'
  }
  $Root = (Resolve-Path $Root).Path
  if ($Root -ne (Get-Location).Path) { Say "installing at the top of this repository: $Root" }

  # On the path, else where Deno's installer puts it: that installer adds its folder to the
  # user's PATH, not to this session's, so right after installing only the folder finds it.
  function Find-Deno {
    $found = Get-Command deno -ErrorAction SilentlyContinue
    if ($found) { return $found }
    $Home_ = if ($env:DENO_INSTALL) { $env:DENO_INSTALL } else { Join-Path $HOME '.deno' }
    $Candidate = Join-Path (Join-Path $Home_ 'bin') 'deno.exe'
    if (Test-Path $Candidate) { return Get-Item $Candidate }
    return $null
  }
  $Deno = Find-Deno
  if (-not $Deno) {
    if ($env:NAIMA_NO_DENO_INSTALL) {
      throw "naima: Deno is missing. Install it once with its official installer, then run this again:`n    irm https://deno.land/install.ps1 | iex"
    }
    Say 'Deno is missing: installing it with its official installer (https://deno.land/install.ps1)'
    Invoke-RestMethod https://deno.land/install.ps1 | Invoke-Expression
    $Deno = Find-Deno
    if (-not $Deno) { throw 'naima: Deno was installed but is not where its installer puts it (~\.deno\bin): open a new terminal and run this again' }
  }
  $DenoExe = if ($Deno.Source) { $Deno.Source } else { $Deno.FullName }

  # The program: a git clone of the source, with core.autocrlf=false recorded so every checkout keeps LF.
  function Get-Naima {
    Say "cloning $Source ($Ref) into $Program"
    Invoke-Checked git @('-c', 'core.autocrlf=false', 'clone', '--quiet', '--config', 'core.autocrlf=false', '--single-branch', '--branch', $Ref, '--', $Source, $Program)
  }
  function Invoke-Naima([string[]]$argv) { Invoke-Checked $DenoExe (@('run', '-A', "$Program/naima.ts") + $argv) }

  # A host installed before the program was a git clone: a copy (carries .naima-copy.json)
  # or a clone of the old full repository (its HEAD still holds naima/src/cli.ts).
  function Test-Legacy {
    if (Test-Path (Join-Path $Program '.naima-copy.json')) { return $true }
    if (-not (Test-Path (Join-Path $Program '.git'))) { return $false }
    & git -C $Program cat-file -e 'HEAD:naima/src/cli.ts' 2>$null
    return $LASTEXITCODE -eq 0
  }

  # Move the legacy program aside, never overwritten, clone the product fresh, and let
  # `naima update` move the lock to its head and migrate the data, as one change to commit.
  function Move-Legacy {
    $Legacy = "naima-tracker/.naima-legacy-$(Get-Date -Format 'yyyyMMddHHmmss')"
    Say "naima-tracker/naima is from before the program was a git clone: moving it to $Legacy"
    Move-Item $Program $Legacy
    Get-Naima
    Invoke-Naima @('update')
    Invoke-Naima @('check')
    Say 'commit the migration:'
    Say '  git add naima-tracker; git commit -m "Migrate Naima to a git clone of the product"'
    Say "  Remove-Item -Recurse -Force $Legacy     # once you have looked at what, if anything, you had changed in it"
  }

  Push-Location $Root
  try {
    if ((Test-Path $Program) -and -not (Test-Path (Join-Path $Program 'naima.ts')) -and -not (Test-Legacy)) {
      throw "naima: $Program exists and is not Naima: move it away, then run this again"
    }
    if (Test-Path $Lock) {
      Say "Naima is already installed here ($Lock): checking it"
      if ((Test-Path $Program) -and (Test-Legacy)) {
        Move-Legacy
      } else {
        if (-not (Test-Path (Join-Path $Program 'naima.ts'))) { Get-Naima }
        Invoke-Naima @('check')
      }
      Say "up to date? naima update --check; to update: naima update (docs: $Program/docs/guide/install.md#updating)"
      return
    }
    if (-not (Test-Path $Program)) { Get-Naima }
    Invoke-Naima @('init')
    Invoke-Naima @('check')
    Write-Host @"

Naima is installed in $Root.

Next:
  git add naima-tracker; git commit -m "Track this project with Naima"
  function naima { deno run -A "`$(git rev-parse --show-toplevel)/naima-tracker/naima/naima.ts" @args }

Agents: read $Program/skills/naima/SKILL.md
"@
  } finally {
    Pop-Location
  }
}

Install-Naima
