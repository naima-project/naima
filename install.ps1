# Install Naima in the git repository you are standing in (Windows PowerShell).
#
#   irm https://naima-project.github.io/naima/install.ps1 | iex
#
# It installs Naima's newest release into naima-tracker\naima\: it downloads the
# release's archive, naima-<version>.tar.gz, checks it against its SHA-256 and
# against the commit its tag names, unpacks it there, and makes that folder a
# git clone of the source at that commit. The download is what counts the
# install, per version: no telemetry. Then it runs its `naima init`: that
# records the clone's origin, its commit, and the release's version and
# checksum in naima-tracker\naima-data\naima.json, beside it,
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
#   NAIMA_SOURCE           the repository (default: Naima's on GitHub)
#   NAIMA_VERSION          the release to install, such as 1.2.0 (default: the newest from 1.1.0-beta.4 on, the first
#                          built for archive installs; a pre-release only while no such stable release exists, or when named)
#   NAIMA_RELEASES         where the releases' assets are downloaded from (default: the source's releases on GitHub)
#   NAIMA_REF              install this branch or tag with git instead of a release, as for developing Naima:
#                          nothing is downloaded, so nothing is counted; also what a source without releases gets
#   NAIMA_NO_DENO_INSTALL  when set, never install Deno: say how, and stop
#   NAIMA_TRACKER          where the tracker lives: private (a git repository of its
#                          own beside the code, on this machine only), inside (committed
#                          with the code), or the URL of a tracker repository to clone;
#                          unset, init keeps it inside a project with no remote or a
#                          private one, and stops with the question for a public one
#
# Run with `irm | iex` it runs in your session, so it never calls `exit`: a
# refusal is an error, and your window stays open.

function Install-Naima {
  $ErrorActionPreference = 'Stop'
  $Source = if ($env:NAIMA_SOURCE) { $env:NAIMA_SOURCE } else { 'https://github.com/naima-project/naima.git' }
  $Ref = if ($env:NAIMA_REF) { $env:NAIMA_REF } else { 'main' }
  $Releases = if ($env:NAIMA_RELEASES) { $env:NAIMA_RELEASES } elseif ($Source -like 'https://github.com/*') { ($Source -replace '\.git$', '') + '/releases' } else { '' }
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
    throw 'naima: this is not a git repository. Is this the root of your project? If so, ask your agent to create a repository here and install Naima from https://naima-project.github.io/naima/'
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
  # The first release built to be installed from its archive: an older release's tree predates the
  # layout this installer unpacks, so it is never chosen as the newest (naima update holds to the same
  # floor, FIRST_ARCHIVE_RELEASE in src/core/releases.ts).
  $FirstArchiveRelease = '1.1.0-beta.4'
  # Which release is the newest, from the source's tags that git lists, picked by Deno: install.sh runs the same script.
  # Releases from $FirstArchiveRelease on; the newest stable one, or, while no stable
  # one qualifies, the newest pre-release.
  # BEGIN newest-release
  $NewestRelease = @'
const [source, floor] = Deno.args
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
const compare = (a, b) => {
  const x = VERSION.exec(a), y = VERSION.exec(b)
  for (const i of [1, 2, 3]) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i])
  const p = x[4] ?? "", q = y[4] ?? ""
  if (p === q) return 0
  if (!p || !q) return p ? -1 : 1
  const ps = p.split("."), qs = q.split(".")
  for (let i = 0; i < Math.max(ps.length, qs.length); i++) {
    const m = ps[i], n = qs[i]
    if (m === undefined || n === undefined) return m === undefined ? -1 : 1
    const d = /^\d+$/.test(m) && /^\d+$/.test(n) ? Number(m) - Number(n) : m.localeCompare(n)
    if (d) return d
  }
  return 0
}
// The tags of the source, read by git as it reads any repository: a version with a suffix (1.2.0-beta.1) is a pre-release.
const listed = new Deno.Command("git", {
  args: ["ls-remote", "--tags", "--refs", "--", source, "v*"],
  env: { GIT_TERMINAL_PROMPT: "0" },
  stdout: "piped",
  stderr: "null",
}).outputSync()
if (!listed.success) Deno.exit(1)
const qualifying = new TextDecoder().decode(listed.stdout).split("\n")
  .map((line) => (line.split("\t")[1] ?? "").trim().replace(/^refs\/tags\//, ""))
  .filter((tag) => VERSION.test(tag))
  .map((tag) => ({ version: tag.replace(/^v/, ""), pre: VERSION.exec(tag)[4] !== undefined }))
  .filter((r) => compare(r.version, floor) >= 0)
const stable = qualifying.filter((r) => !r.pre)
const newest = (stable.length ? stable : qualifying).sort((a, b) => compare(b.version, a.version))[0]
if (!newest) Deno.exit(1)
console.log(newest.version)
'@
  # END newest-release
  # The program from a release: the archive downloaded and checked, unpacked, and made a git clone at its commit.
  function Get-Release {
    $Version = $env:NAIMA_VERSION
    if (-not $Version) {
      $Script = Join-Path ([System.IO.Path]::GetTempPath()) ("naima-newest-" + [guid]::NewGuid() + '.js')
      Set-Content -Path $Script -Value $NewestRelease -Encoding UTF8
      try { $Version = (& $DenoExe run --quiet --allow-run=git --allow-env $Script $Source $FirstArchiveRelease | Select-Object -Last 1) }
      finally { Remove-Item -Force $Script -ErrorAction SilentlyContinue }
      if ($LASTEXITCODE -ne 0 -or -not $Version) { throw "naima: cannot find a release of $Source from $FirstArchiveRelease on: check the network, or name one with NAIMA_VERSION" }
      $Version = $Version.Trim()
    }
    $Version = $Version -replace '^v', ''
    $Name = Split-Path -Leaf ($Source -replace '\.git$', '')
    $Archive = "$Name-$Version.tar.gz"
    $Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("naima-install-" + [guid]::NewGuid())
    New-Item -ItemType Directory $Tmp | Out-Null
    try {
      Say "downloading release v$Version ($Archive) from $Releases"
      Invoke-WebRequest -UseBasicParsing -Uri "$Releases/download/v$Version/$Archive" -OutFile (Join-Path $Tmp $Archive)
      Invoke-WebRequest -UseBasicParsing -Uri "$Releases/download/v$Version/$Archive.sha256" -OutFile (Join-Path $Tmp "$Archive.sha256")
      $Want = ((Get-Content -Raw (Join-Path $Tmp "$Archive.sha256")).Trim() -split '\s+')[0].ToLower()
      $Got = (Get-FileHash -Algorithm SHA256 (Join-Path $Tmp $Archive)).Hash.ToLower()
      if ($Want -ne $Got) { throw "naima: $Archive has SHA-256 $Got, but $Archive.sha256 says ${Want}: refused, nothing installed" }
      # The commit git archive recorded, read by git from the uncompressed archive.
      $In = [System.IO.File]::OpenRead((Join-Path $Tmp $Archive))
      $Out = [System.IO.File]::Create((Join-Path $Tmp 'archive.tar'))
      try { (New-Object System.IO.Compression.GZipStream($In, [System.IO.Compression.CompressionMode]::Decompress)).CopyTo($Out) } finally { $Out.Close(); $In.Close() }
      $Commit = (& cmd /c "git get-tar-commit-id < `"$(Join-Path $Tmp 'archive.tar')`"").Trim()
      if ($Commit -notmatch '^[0-9a-f]{40}$') { throw "naima: $Archive records no commit, so git archive did not make it: refused, nothing installed" }
      New-Item -ItemType Directory -Force $Program | Out-Null
      Invoke-Checked tar @('-xzf', (Join-Path $Tmp $Archive), '-C', $Program, '--strip-components=1')
      try {
        Invoke-Checked git @('-C', $Program, 'init', '-q')
        Invoke-Checked git @('-C', $Program, 'config', 'core.autocrlf', 'false')
        Invoke-Checked git @('-C', $Program, 'remote', 'add', 'origin', $Source)
        Invoke-Checked git @('-C', $Program, 'fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main', "+refs/tags/v${Version}:refs/tags/v$Version")
        $Tagged = (& git -C $Program rev-parse "refs/tags/v$Version^{commit}").Trim()
        if ($Tagged -ne $Commit) { throw "naima: $Archive was made from $Commit, and the tag v$Version names another commit: refused, nothing installed" }
        # A branch main at the source's main, as a clone has: a clone of this folder (a worktree's program, made from it)
        # takes it as its origin's main, so the source's commits it holds never read as commits of its own.
        Invoke-Checked git @('-C', $Program, 'update-ref', 'refs/heads/main', 'refs/remotes/origin/main')
        Invoke-Checked git @('-C', $Program, 'read-tree', $Commit)
        Invoke-Checked git @('-C', $Program, 'update-ref', '--no-deref', 'HEAD', $Commit)
        if (& git -C $Program status --porcelain --untracked-files=all) { throw "naima: the files of $Archive are not those of v${Version}: refused, nothing installed" }
      } catch {
        Remove-Item -Recurse -Force $Program
        throw
      }
      Set-Content -NoNewline -Path (Join-Path $Program '.git/naima-release.json') -Value "{ `"version`": `"$Version`", `"sha256`": `"$Got`", `"commit`": `"$Commit`" }`n"
      Say "installed release v$Version, SHA-256 $Got checked"
    } finally {
      Remove-Item -Recurse -Force $Tmp
    }
  }
  # The program: a release, unless a branch or tag is asked for, or the source publishes no releases.
  function Install-Program { if (-not $env:NAIMA_REF -and $Releases) { Get-Release } else { Get-Naima } }
  function Invoke-Naima([string[]]$argv) { Invoke-Checked $DenoExe (@('run', '-A', "$Program/naima.ts") + $argv) }

  # A host installed before the program was a git clone: a copy (carries .naima-copy.json)
  # or a clone of the old full repository (its HEAD still holds naima/src/cli.ts).
  function Test-Legacy {
    if (Test-Path (Join-Path $Program '.naima-copy.json')) { return $true }
    if (-not (Test-Path (Join-Path $Program '.git'))) { return $false }
    # On a current clone the path is absent and git says so on stderr: see the root check above.
    $ErrorActionPreference = 'Continue'
    & git -C $Program cat-file -e 'HEAD:naima/src/cli.ts' 2>$null
    return $LASTEXITCODE -eq 0
  }

  # What to add for the commit Naima's setup asks for: naima-tracker/ (the tracker and the launchers) and every
  # file of the agents' setup outside it that git sees changed, the files the trunk guard takes with a Naima-Setup: trailer.
  function Get-SetupPaths {
    $paths = @('naima-tracker')
    foreach ($f in @('AGENTS.md', 'CLAUDE.md', '.claude/settings.json', '.cursorrules', '.github/copilot-instructions.md', 'GEMINI.md')) {
      if (& git status --porcelain -- $f 2>$null) { $paths += $f }
    }
    return ($paths -join ' ')
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
    Say "  git add $(Get-SetupPaths); git commit -m `"Migrate Naima to a git clone of the product`" -m `"Naima-Setup: migrate`"
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
    if (-not (Test-Path $Program)) { Install-Program }
    $Tracker = switch ($env:NAIMA_TRACKER) {
      { -not $_ } { @(); break }
      'private' { @('--private-tracker'); break }
      'inside' { @('--tracker-inside'); break }
      default { @('--tracker', $env:NAIMA_TRACKER) }
    }
    Invoke-Naima (@('init') + $Tracker)
    Invoke-Naima @('check')
    $SetupPaths = Get-SetupPaths
    Write-Host @"

Naima is installed in $Root.

Next:
  git add $SetupPaths; git commit -m "Track this project with Naima" -m "Naima-Setup: install"
  function naima { deno run -A "`$(git rev-parse --show-toplevel)/naima-tracker/naima/naima.ts" @args }

Agents: read $Program/skills/naima/SKILL.md
"@
  } finally {
    Pop-Location
  }
}

Install-Naima
