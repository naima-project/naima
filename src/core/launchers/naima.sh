#!/bin/sh
# Naima's launcher, committed with the project in its tracker folder: what every hook Naima installs runs,
# and what to run Naima with on macOS and Linux:
#
#   sh naima-tracker/naima.sh <command> [arguments]
#
# Written by naima init and naima update from the program's src/core/launchers/naima.sh: never edit it
# here, the next update rewrites it. When nothing is missing it runs Naima and says nothing. On a machine
# without Deno, it puts Deno, at the version below and checked against its SHA-256, into the gitignored
# folder .bin/ beside this file; when the program (naima/, gitignored) is missing, as in a fresh clone,
# it restores it from the lock, naima-data/naima.json: the locked release's archive, checked against the
# lock's checksum, or else a git clone of the lock's source. Each repair is said in one line on standard
# error. Then it runs Naima with the same arguments. On Windows (Git Bash) it hands over to naima.ps1.
#
#   NAIMA_DENO_DOWNLOADS  where Deno's release archives are (default: Deno's releases on GitHub)
#   NAIMA_RELEASES        where Naima's releases' assets are (default: the lock's source's releases on GitHub)

set -eu

DENO_VERSION=2.9.7
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
program="$here/naima"
lock="$here/naima-data/naima.json"

say() { printf 'naima: %s\n' "$*" >&2; }
die() {
  say "$*"
  exit 1
}

case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*)
    ps1="$here/naima.ps1"
    if command -v cygpath >/dev/null 2>&1; then ps1=$(cygpath -w "$ps1"); fi
    exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ps1" "$@"
    ;;
esac

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    die "neither curl nor wget is here to download $1: install one of them, then run this again"
  fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    die "neither sha256sum nor shasum is here to check a download's checksum"
  fi
}

find_deno() {
  for d in "$(command -v deno 2>/dev/null || true)" "${DENO_INSTALL:-}/bin/deno" "$HOME/.deno/bin/deno" "$here/.bin/deno"; do
    if [ -n "$d" ] && [ -f "$d" ] && [ -x "$d" ]; then
      DENO=$d
      return 0
    fi
  done
  return 1
}

# Deno, pinned: the archive of DENO_VERSION for this machine, checked against its SHA-256, unpacked into .bin/.
install_deno() {
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) target=aarch64-apple-darwin want=5cd46d6268f6f78f5d88bdc7159d20bd44cdaa4b3303474839f87ec6fe7ae25c ;;
    Darwin-x86_64) target=x86_64-apple-darwin want=95daaff11c116a52ad54785e7914c8e9c9cdcaba793c5ed929c74ca2d8e6259a ;;
    Linux-x86_64) target=x86_64-unknown-linux-gnu want=c6527f24f4b16031d3ae4fa9f658d5f11534c8d84ce7dc8502420280919c3490 ;;
    Linux-aarch64 | Linux-arm64) target=aarch64-unknown-linux-gnu want=c832298b1ad4422481334855f6003e0f54145762c5a134f20a489511d2f65bbf ;;
    *) die "Deno is missing, and there is no Deno for $(uname -s) $(uname -m) to install: install Deno (https://docs.deno.com/runtime/getting_started/installation/), then run this again" ;;
  esac
  zip="deno-$target.zip"
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/naima-deno.XXXXXX")
  download "${NAIMA_DENO_DOWNLOADS:-https://github.com/denoland/deno/releases/download}/v$DENO_VERSION/$zip" "$tmp/$zip" || {
    rm -rf "$tmp"
    die "Deno is missing, and $zip cannot be downloaded: check the network, or install Deno, then run this again"
  }
  got=$(sha256 "$tmp/$zip")
  if [ "$got" != "$want" ]; then
    rm -rf "$tmp"
    die "$zip has SHA-256 $got, but Deno $DENO_VERSION's is $want: refused, nothing installed"
  fi
  if command -v unzip >/dev/null 2>&1; then
    unzip -q -o "$tmp/$zip" -d "$tmp/out"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -I -m zipfile -e "$tmp/$zip" "$tmp/out"
  else
    rm -rf "$tmp"
    die "Deno is missing, and neither unzip nor python3 is here to unpack it: install one of them, or Deno, then run this again"
  fi
  mkdir -p "$here/.bin"
  mv -f "$tmp/out/deno" "$here/.bin/deno"
  chmod 755 "$here/.bin/deno"
  rm -rf "$tmp"
  DENO="$here/.bin/deno"
  say "Deno was missing: installed Deno $DENO_VERSION into $(basename "$here")/.bin/, SHA-256 checked"
}

# One field of the lock, read by Deno's JSON parser: empty when absent.
field() {
  "$DENO" eval 'const v = JSON.parse(Deno.readTextFileSync(Deno.args[0]))[Deno.args[1]]; console.log(typeof v === "string" ? v : "")' "$lock" "$1"
}

# The program, from the lock: the locked release's archive, checked against the lock's checksum and made a git
# clone at the locked commit; with no release locked, a git clone of the source, which Naima then aligns to the lock.
restore_program() {
  [ -f "$lock" ] || die "the program ($program) is missing, and there is no lock at $lock to restore it from: see $here/README.md"
  command -v git >/dev/null 2>&1 || die "the program is missing, and git, which restores it, is not here: install git, then run this again"
  source=$(field source)
  commit=$(field commit)
  version=$(field version)
  locked=$(field sha256)
  [ -n "$source" ] && [ -n "$commit" ] || die "the lock at $lock names no source and commit to restore the program from"
  case "$source" in
    https://github.com/*) releases=${NAIMA_RELEASES:-${source%.git}/releases} ;;
    *) releases=${NAIMA_RELEASES:-} ;;
  esac
  if [ -n "$version" ] && [ -n "$locked" ] && [ -n "$releases" ]; then
    command -v tar >/dev/null 2>&1 || die "the program is missing, and tar, which unpacks its release, is not here: install it, then run this again"
    archive="$(basename "${source%.git}")-$version.tar.gz"
    tmp=$(mktemp -d "${TMPDIR:-/tmp}/naima-release.XXXXXX")
    download "$releases/download/v$version/$archive" "$tmp/$archive" || {
      rm -rf "$tmp"
      die "the program is missing, and $archive cannot be downloaded from $releases: check the network, then run this again"
    }
    got=$(sha256 "$tmp/$archive")
    if [ "$got" != "$locked" ]; then
      rm -rf "$tmp"
      die "$archive has SHA-256 $got, but the lock says $locked: refused, nothing restored"
    fi
    mkdir -p "$program"
    if ! {
      tar -xzf "$tmp/$archive" -C "$program" --strip-components=1 &&
        git -C "$program" init -q &&
        git -C "$program" config core.autocrlf false &&
        git -C "$program" remote add origin "$source" &&
        git -C "$program" fetch -q origin "+refs/heads/main:refs/remotes/origin/main" "+refs/tags/v$version:refs/tags/v$version" &&
        [ "$(git -C "$program" rev-parse "refs/tags/v$version^{commit}")" = "$commit" ] &&
        git -C "$program" read-tree "$commit" &&
        git -C "$program" update-ref --no-deref HEAD "$commit" &&
        [ -z "$(git -C "$program" status --porcelain --untracked-files=all)" ]
    }; then
      rm -rf "$tmp" "$program"
      die "cannot restore the program from $archive: its files, or the commit of its tag v$version, are not those the lock names ($commit); nothing restored"
    fi
    rm -rf "$tmp"
    say "the program was missing: restored version $version from its release, SHA-256 checked, at ${commit%"${commit#????????????}"}"
  else
    git -c core.autocrlf=false clone --quiet --config core.autocrlf=false -- "$source" "$program" ||
      die "the program is missing, and $source cannot be cloned: check the network, then run this again"
    git -C "$program" checkout --quiet --detach "$commit" 2>/dev/null || true
    say "the program was missing: cloned $source, locked at ${commit%"${commit#????????????}"}"
  fi
}

find_deno || install_deno
[ -f "$program/naima.ts" ] || restore_program
PATH="$(dirname -- "$DENO"):$PATH"
export PATH
exec "$DENO" run -A "$program/naima.ts" "$@"
