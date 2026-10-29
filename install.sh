#!/bin/sh
# Install Naima in the git repository you are standing in (macOS, Linux).
#
#   curl -fsSL https://naima-project.github.io/naima/install.sh | sh
#
# It installs Naima's newest release into naima-tracker/naima/: it downloads the
# release's archive, naima-<version>.tar.gz, checks it against its SHA-256 and
# against the commit its tag names, unpacks it there, and makes that folder a
# git clone of the source at that commit (so updates and worktrees work as they
# do for any clone). The download is what counts the install, per version: no
# telemetry. Then it runs its `naima init`: that records the clone's origin,
# its commit, and the release's version and checksum in
# naima-tracker/naima-data/naima.json, beside it,
# writes the tracker folder's README.md and .gitignore, and points the
# project's agent file at Naima's own, saying to run naima hello at the start
# of every session, with a session-start hook for each agent tool in use that
# has one. Then it runs `naima check`. Nothing is
# installed globally for Naima; Deno, the one thing Naima needs on the
# machine, is installed with its official installer when it is missing. Run
# again, it says Naima is installed and checks it, cloning the program again
# first when it is missing (at the locked commit, if the clone that holds it
# is gone). On a host installed before the program was a git clone — a copy
# (`naima/.naima-copy.json`) or a clone of the old full repository (its `HEAD`
# holds `naima/src/cli.ts`) — it is moved aside to
# `naima-tracker/.naima-legacy-<date>`, never overwritten, the product is
# cloned fresh, and `naima update` moves the lock to its head and migrates the
# data; the one commit to make is printed. What it does by hand:
# naima/docs/guide/install.md#bootstrap-a-project.
#
#   NAIMA_SOURCE           the repository (default: Naima's on GitHub)
#   NAIMA_VERSION          the release to install, such as 1.2.0 (default: the newest from 1.1.0-beta.4 on, the first
#                          built for archive installs; a pre-release only while no such stable release exists, or when named)
#   NAIMA_RELEASES         where the releases' assets are downloaded from (default: the source's releases on GitHub);
#                          the archive is $NAIMA_RELEASES/download/v<version>/naima-<version>.tar.gz
#   NAIMA_REF              install this branch or tag with git instead of a release, as for developing Naima:
#                          nothing is downloaded, so nothing is counted; also what a source without releases gets
#   NAIMA_NO_DENO_INSTALL  when set, never install Deno: say how, and stop
#   NAIMA_TRACKER          where the tracker lives: private (a git repository of its
#                          own beside the code, on this machine only), inside (committed
#                          with the code), or the URL of a tracker repository to clone;
#                          unset, init keeps it inside a project with no remote or a
#                          private one, and stops with the question for a public one

set -eu

SOURCE=${NAIMA_SOURCE:-https://github.com/naima-project/naima.git}
REF=${NAIMA_REF:-main}
# The releases: on GitHub, beside the source; elsewhere only when NAIMA_RELEASES names them.
case "$SOURCE" in
  https://github.com/*) RELEASES=${NAIMA_RELEASES:-${SOURCE%.git}/releases} ;;
  *) RELEASES=${NAIMA_RELEASES:-} ;;
esac
PROGRAM=naima-tracker/naima
LOCK=naima-tracker/naima-data/naima.json

say() { printf 'naima: %s\n' "$*"; }
die() {
  printf 'naima: %s\n' "$*" >&2
  exit 1
}

need_git() {
  command -v git >/dev/null 2>&1 && return 0
  case "$(uname -s)" in
    Darwin) die "git is missing: install it with 'xcode-select --install' (or 'brew install git' with Homebrew), then run this again" ;;
    *) die "git is missing: install it with your package manager (sudo apt install git, sudo dnf install git, sudo pacman -S git, ...), then run this again" ;;
  esac
}

find_deno() {
  if command -v deno >/dev/null 2>&1; then
    DENO=$(command -v deno)
    return 0
  fi
  for d in "${DENO_INSTALL:-}/bin/deno" "$HOME/.deno/bin/deno"; do
    if [ -x "$d" ]; then
      DENO=$d
      return 0
    fi
  done
  return 1
}

need_deno() {
  find_deno && return 0
  if [ -n "${NAIMA_NO_DENO_INSTALL:-}" ]; then
    die "Deno is missing. Install it once with its official installer, then run this again:
    curl -fsSL https://deno.land/install.sh | sh"
  fi
  say "Deno is missing: installing it with its official installer (https://deno.land/install.sh)"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://deno.land/install.sh | sh -s -- -y
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- https://deno.land/install.sh | sh -s -- -y
  else
    die "neither curl nor wget is here to fetch Deno's installer: install Deno (https://docs.deno.com/runtime/getting_started/installation/), then run this again"
  fi
  find_deno || die "Deno was installed but is not where its installer puts it (~/.deno/bin): open a new shell and run this again"
}

naima() { "$DENO" run -A "$PROGRAM/naima.ts" "$@"; }

# The program: a git clone of the source, LF kept on every platform.
clone_naima() {
  say "cloning $SOURCE ($REF) into $PROGRAM"
  git -c core.autocrlf=false clone --quiet --config core.autocrlf=false --single-branch --branch "$REF" -- "$SOURCE" "$PROGRAM" ||
    die "cannot clone $SOURCE ($REF): check the network, or NAIMA_SOURCE and NAIMA_REF"
}

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    die "neither curl nor wget is here to download Naima's release: install one of them, then run this again"
  fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    die "neither sha256sum nor shasum is here to check the release's checksum"
  fi
}

# The first release built to be installed from its archive: an older release's tree predates the
# layout this installer unpacks, so it is never chosen as the newest (naima update holds to the same
# floor, FIRST_ARCHIVE_RELEASE in src/core/releases.ts).
FIRST_ARCHIVE_RELEASE=1.1.0-beta.4

# Which release is the newest, from the source's tags that git lists, picked by Deno: install.ps1 runs the same script.
# Releases from FIRST_ARCHIVE_RELEASE on; the newest stable one, or, while no stable
# one qualifies, the newest pre-release.
# BEGIN newest-release
NEWEST_RELEASE=$(cat <<'EOF'
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
EOF
)
# END newest-release

newest_version() {
  "$DENO" eval "$NEWEST_RELEASE" "$SOURCE" "$FIRST_ARCHIVE_RELEASE"
}

# The program from a release: the archive downloaded and checked, unpacked, and made a git clone at its commit.
install_release() {
  command -v tar >/dev/null 2>&1 || die "tar is missing: it unpacks Naima's release; install it, then run this again"
  VERSION=${NAIMA_VERSION:-}
  if [ -z "$VERSION" ]; then
    VERSION=$(newest_version) || die "cannot find a release of $SOURCE from $FIRST_ARCHIVE_RELEASE on: check the network, or name one with NAIMA_VERSION"
  fi
  VERSION=${VERSION#v}
  NAME=$(basename "${SOURCE%.git}")
  ARCHIVE="$NAME-$VERSION.tar.gz"
  TMP=$(mktemp -d "${TMPDIR:-/tmp}/naima-install.XXXXXX")
  trap 'rm -rf "$TMP"' EXIT
  say "downloading release v$VERSION ($ARCHIVE) from $RELEASES"
  download "$RELEASES/download/v$VERSION/$ARCHIVE" "$TMP/$ARCHIVE" ||
    die "cannot download $ARCHIVE from $RELEASES: check the network, or NAIMA_VERSION"
  download "$RELEASES/download/v$VERSION/$ARCHIVE.sha256" "$TMP/$ARCHIVE.sha256" ||
    die "cannot download $ARCHIVE.sha256 from $RELEASES: check the network, or NAIMA_VERSION"
  WANT=$(cut -d' ' -f1 <"$TMP/$ARCHIVE.sha256")
  GOT=$(sha256 "$TMP/$ARCHIVE")
  [ "$WANT" = "$GOT" ] || die "$ARCHIVE has SHA-256 $GOT, but $ARCHIVE.sha256 says $WANT: refused, nothing installed"
  COMMIT=$(gzip -dc "$TMP/$ARCHIVE" | git get-tar-commit-id) || die "$ARCHIVE records no commit, so git archive did not make it: refused, nothing installed"
  mkdir -p "$PROGRAM"
  tar -xzf "$TMP/$ARCHIVE" -C "$PROGRAM" --strip-components=1 || {
    rm -rf "$PROGRAM"
    die "cannot unpack $ARCHIVE"
  }
  # A git clone of the source at that commit, its files the archive's, checked to be the commit's exactly.
  if ! {
    git -C "$PROGRAM" init -q &&
      git -C "$PROGRAM" config core.autocrlf false &&
      git -C "$PROGRAM" remote add origin "$SOURCE" &&
      git -C "$PROGRAM" fetch -q origin "+refs/heads/main:refs/remotes/origin/main" "+refs/tags/v$VERSION:refs/tags/v$VERSION"
  }; then
    rm -rf "$PROGRAM"
    die "cannot fetch v$VERSION from $SOURCE: check the network"
  fi
  if [ "$(git -C "$PROGRAM" rev-parse "refs/tags/v$VERSION^{commit}")" != "$COMMIT" ]; then
    rm -rf "$PROGRAM"
    die "$ARCHIVE was made from $COMMIT, and the tag v$VERSION names another commit: refused, nothing installed"
  fi
  # A branch main at the source's main, as a clone has: a clone of this folder (a worktree's program, made from it)
  # takes it as its origin's main, so the source's commits it holds never read as commits of its own.
  git -C "$PROGRAM" update-ref refs/heads/main refs/remotes/origin/main
  git -C "$PROGRAM" read-tree "$COMMIT"
  git -C "$PROGRAM" update-ref --no-deref HEAD "$COMMIT"
  if [ -n "$(git -C "$PROGRAM" status --porcelain --untracked-files=all)" ]; then
    rm -rf "$PROGRAM"
    die "the files of $ARCHIVE are not those of v$VERSION: refused, nothing installed"
  fi
  printf '{ "version": "%s", "sha256": "%s", "commit": "%s" }\n' "$VERSION" "$GOT" "$COMMIT" >"$PROGRAM/.git/naima-release.json"
  say "installed release v$VERSION, SHA-256 $GOT checked"
}

# The program: a release, unless a branch or tag is asked for, or the source publishes no releases.
install_program() {
  if [ -z "${NAIMA_REF:-}" ] && [ -n "$RELEASES" ]; then install_release; else clone_naima; fi
}

# A host installed before the program was a git clone: a copy (carries .naima-copy.json)
# or a clone of the old full repository (its HEAD still holds naima/src/cli.ts).
is_legacy() {
  [ -f "$PROGRAM/.naima-copy.json" ] && return 0
  [ -d "$PROGRAM/.git" ] && git -C "$PROGRAM" cat-file -e HEAD:naima/src/cli.ts >/dev/null 2>&1
}

# What to add for the commit Naima's setup asks for: naima-tracker/ (the tracker and the launchers) and every
# file of the agents' setup outside it that git sees changed, the files the trunk guard takes with a Naima-Setup: trailer.
setup_paths() {
  paths=naima-tracker
  for f in AGENTS.md CLAUDE.md .claude/settings.json .cursorrules .github/copilot-instructions.md GEMINI.md; do
    if [ -n "$(git status --porcelain -- "$f" 2>/dev/null)" ]; then paths="$paths $f"; fi
  done
  printf '%s' "$paths"
}

# Move the legacy program aside, never overwritten, clone the product fresh, and let
# `naima update` move the lock to its head and migrate the data, as one change to commit.
migrate_legacy() {
  LEGACY="naima-tracker/.naima-legacy-$(date +%Y%m%d%H%M%S)"
  say "naima-tracker/naima is from before the program was a git clone: moving it to $LEGACY"
  mv "$PROGRAM" "$LEGACY"
  clone_naima
  naima update
  naima check
  say "commit the migration:"
  say "  git add $(setup_paths) && git commit -m \"Migrate Naima to a git clone of the product\" -m \"Naima-Setup: migrate\""
  say "  rm -rf $LEGACY     # once you have looked at what, if anything, you had changed in it"
}

next_steps() {
  cat <<EOF

Naima is installed in $ROOT.

Next:
  git add $(setup_paths) && git commit -m "Track this project with Naima" -m "Naima-Setup: install"
  alias naima='deno run -A "\$(git rev-parse --show-toplevel)/naima-tracker/naima/naima.ts"'

Agents: read $PROGRAM/skills/naima/SKILL.md
EOF
}

main() {
  need_git
  ROOT=$(git rev-parse --show-toplevel 2>/dev/null) ||
    die "this is not a git repository. Is this the root of your project? If so, ask your agent to create a repository here and install Naima from https://naima-project.github.io/naima/"
  if [ "$(cd "$ROOT" && pwd -P)" != "$(pwd -P)" ]; then say "installing at the top of this repository: $ROOT"; fi
  cd "$ROOT"
  need_deno

  if [ -e "$PROGRAM" ] && [ ! -f "$PROGRAM/naima.ts" ] && ! is_legacy; then
    die "$PROGRAM exists and is not Naima: move it away, then run this again"
  fi

  if [ -f "$LOCK" ]; then
    say "Naima is already installed here ($LOCK): checking it"
    if [ -e "$PROGRAM" ] && is_legacy; then
      migrate_legacy
    else
      [ -f "$PROGRAM/naima.ts" ] || clone_naima
      naima check
    fi
    say "up to date? naima update --check; to update: naima update (docs: $PROGRAM/docs/guide/install.md#updating)"
    return 0
  fi

  [ -e "$PROGRAM" ] || install_program
  case "${NAIMA_TRACKER:-}" in
    "") naima init ;;
    private) naima init --private-tracker ;;
    inside) naima init --tracker-inside ;;
    *) naima init --tracker "$NAIMA_TRACKER" ;;
  esac
  naima check
  next_steps
}

main "$@"
