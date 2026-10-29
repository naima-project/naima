# Naima's launcher for Windows, committed with the project in its tracker folder: what naima.cmd and
# naima.sh (under Git Bash) hand over to. Run Naima with it from PowerShell or cmd:
#
#   naima-tracker\naima.cmd <command> [arguments]
#
# Written by naima init and naima update from the program's src/core/launchers/naima.ps1: never edit it
# here, the next update rewrites it. When nothing is missing it runs Naima and says nothing. On a machine
# without Deno, it puts Deno, at the version below and checked against its SHA-256, into the gitignored
# folder .bin\ beside this file; when the program (naima\, gitignored) is missing, as in a fresh clone,
# it restores it from the lock, naima-data\naima.json: the locked release's archive, checked against the
# lock's checksum, or else a git clone of the lock's source. Each repair is said in one line on standard
# error. Then it runs Naima with the same arguments. It needs no administrator rights and writes nothing
# outside the project.
#
#   NAIMA_DENO_DOWNLOADS  where Deno's release archives are (default: Deno's releases on GitHub)
#   NAIMA_RELEASES        where Naima's releases' assets are (default: the lock's source's releases on GitHub)

# Native commands (git, tar) are checked by their exit codes; a cmdlet that fails stops the script by its own -ErrorAction.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$DenoVersion = '2.9.7'
$Here = $PSScriptRoot
$Program = Join-Path $Here 'naima'
$Lock = Join-Path (Join-Path $Here 'naima-data') 'naima.json'

function Say([string]$m) { [Console]::Error.WriteLine("naima: $m") }
function Fail([string]$m) { Say $m; exit 1 }

function Find-Deno {
  $onPath = Get-Command deno -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  $candidates = @()
  if ($onPath) { $candidates += $onPath.Source }
  if ($env:DENO_INSTALL) { $candidates += (Join-Path (Join-Path $env:DENO_INSTALL 'bin') 'deno.exe') }
  $candidates += (Join-Path (Join-Path (Join-Path $HOME '.deno') 'bin') 'deno.exe')
  $candidates += (Join-Path (Join-Path $Here '.bin') 'deno.exe')
  foreach ($c in $candidates) { if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) { return $c } }
  return $null
}

function Get-Sha256([string]$path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLower() }

function New-TempDir([string]$prefix) {
  $dir = Join-Path ([System.IO.Path]::GetTempPath()) ($prefix + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $dir -ErrorAction Stop | Out-Null
  return $dir
}

# Deno, pinned: the archive of $DenoVersion for this machine, checked against its SHA-256, unpacked into .bin\.
function Install-Deno {
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
    $target = 'aarch64-pc-windows-msvc'; $want = 'c4c4ac8bfdaa37814bda5c05fc9cdf2154904e2ef8277673a30bdceaaa649807'
  } else {
    $target = 'x86_64-pc-windows-msvc'; $want = 'a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238'
  }
  $zip = "deno-$target.zip"
  $base = if ($env:NAIMA_DENO_DOWNLOADS) { $env:NAIMA_DENO_DOWNLOADS } else { 'https://github.com/denoland/deno/releases/download' }
  $tmp = New-TempDir 'naima-deno-'
  try {
    try { Invoke-WebRequest -UseBasicParsing -Uri "$base/v$DenoVersion/$zip" -OutFile (Join-Path $tmp $zip) -ErrorAction Stop }
    catch { Fail "Deno is missing, and $zip cannot be downloaded: check the network, or install Deno, then run this again" }
    $got = Get-Sha256 (Join-Path $tmp $zip)
    if ($got -ne $want) { Fail "$zip has SHA-256 $got, but Deno $DenoVersion's is ${want}: refused, nothing installed" }
    Expand-Archive -LiteralPath (Join-Path $tmp $zip) -DestinationPath (Join-Path $tmp 'out') -Force -ErrorAction Stop
    $bin = Join-Path $Here '.bin'
    if (-not (Test-Path -LiteralPath $bin)) { New-Item -ItemType Directory -Path $bin -ErrorAction Stop | Out-Null }
    Move-Item -Force -LiteralPath (Join-Path (Join-Path $tmp 'out') 'deno.exe') -Destination (Join-Path $bin 'deno.exe') -ErrorAction Stop
  } finally {
    Remove-Item -Recurse -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
  }
  Say "Deno was missing: installed Deno $DenoVersion into $(Split-Path -Leaf $Here)\.bin\, SHA-256 checked"
  return (Join-Path (Join-Path $Here '.bin') 'deno.exe')
}

function Invoke-Git([string[]]$argv) {
  & git @argv
  if ($LASTEXITCODE -ne 0) { throw "git $($argv -join ' ') failed" }
}

# The program, from the lock: the locked release's archive, checked against the lock's checksum and made a git
# clone at the locked commit; with no release locked, a git clone of the source, which Naima then aligns to the lock.
function Restore-Program {
  if (-not (Test-Path -LiteralPath $Lock)) { Fail "the program ($Program) is missing, and there is no lock at $Lock to restore it from: see $(Join-Path $Here 'README.md')" }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'the program is missing, and git, which restores it, is not here: install Git for Windows, then run this again' }
  $l = Get-Content -Raw -LiteralPath $Lock -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  $source = [string]$l.source; $commit = [string]$l.commit; $version = [string]$l.version; $locked = [string]$l.sha256
  if (-not $source -or -not $commit) { Fail "the lock at $Lock names no source and commit to restore the program from" }
  $releases = if ($env:NAIMA_RELEASES) { $env:NAIMA_RELEASES } elseif ($source -like 'https://github.com/*') { ($source -replace '\.git$', '') + '/releases' } else { '' }
  $short = $commit.Substring(0, [Math]::Min(12, $commit.Length))
  if ($version -and $locked -and $releases) {
    $archive = "$(Split-Path -Leaf ($source -replace '\.git$', ''))-$version.tar.gz"
    $tmp = New-TempDir 'naima-release-'
    try {
      try { Invoke-WebRequest -UseBasicParsing -Uri "$releases/download/v$version/$archive" -OutFile (Join-Path $tmp $archive) -ErrorAction Stop }
      catch { Fail "the program is missing, and $archive cannot be downloaded from ${releases}: check the network, then run this again" }
      $got = Get-Sha256 (Join-Path $tmp $archive)
      if ($got -ne $locked.ToLower()) { Fail "$archive has SHA-256 $got, but the lock says ${locked}: refused, nothing restored" }
      New-Item -ItemType Directory -Force -Path $Program -ErrorAction Stop | Out-Null
      try {
        & tar.exe -xzf (Join-Path $tmp $archive) -C $Program --strip-components=1
        if ($LASTEXITCODE -ne 0) { throw "tar could not unpack $archive" }
        Invoke-Git @('-C', $Program, 'init', '-q')
        Invoke-Git @('-C', $Program, 'config', 'core.autocrlf', 'false')
        Invoke-Git @('-C', $Program, 'remote', 'add', 'origin', $source)
        Invoke-Git @('-C', $Program, 'fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main', "+refs/tags/v${version}:refs/tags/v$version")
        $tagged = (& git -C $Program rev-parse "refs/tags/v$version^{commit}").Trim()
        if ($tagged -ne $commit) { throw "the tag v$version names $tagged" }
        Invoke-Git @('-C', $Program, 'read-tree', $commit)
        Invoke-Git @('-C', $Program, 'update-ref', '--no-deref', 'HEAD', $commit)
        if (& git -C $Program status --porcelain --untracked-files=all) { throw 'its files differ from the commit' }
      } catch {
        Remove-Item -Recurse -Force -LiteralPath $Program -ErrorAction SilentlyContinue
        Fail "cannot restore the program from ${archive}: $($_.Exception.Message), and the lock names $commit; nothing restored"
      }
    } finally {
      Remove-Item -Recurse -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
    }
    Say "the program was missing: restored version $version from its release, SHA-256 checked, at $short"
  } else {
    & git -c core.autocrlf=false clone --quiet --config core.autocrlf=false -- $source $Program
    if ($LASTEXITCODE -ne 0) { Fail "the program is missing, and $source cannot be cloned: check the network, then run this again" }
    & git -C $Program checkout --quiet --detach $commit
    Say "the program was missing: cloned $source, locked at $short"
  }
}

$Deno = Find-Deno
if (-not $Deno) { $Deno = Install-Deno }
if (-not (Test-Path -LiteralPath (Join-Path $Program 'naima.ts'))) { Restore-Program }
$env:PATH = (Split-Path -Parent $Deno) + [System.IO.Path]::PathSeparator + $env:PATH
& $Deno run -A (Join-Path $Program 'naima.ts') @args
exit $LASTEXITCODE
