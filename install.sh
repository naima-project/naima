#!/bin/sh
# Install Naima in the git repository you are standing in (macOS, Linux).
#
#   curl -fsSL https://naima-project.github.io/naima/install.sh | sh
#
# It clones Naima into naima-tracker/naima/ (a branch or a tag, no temporary
# clone), and runs its `naima init`: that records the
# clone's origin and commit in naima-tracker/naima-data/naima.json, beside it,
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
#   NAIMA_SOURCE           the repository to clone (default: Naima's on GitHub)
#   NAIMA_REF              the branch or tag to install (default: main)
#   NAIMA_NO_DENO_INSTALL  when set, never install Deno: say how, and stop
#   NAIMA_TRACKER          where the tracker lives: private (a git repository of its
#                          own beside the code, on this machine only), inside (committed
#                          with the code), or the URL of a tracker repository to clone;
#                          unset, init keeps it inside a project with no remote or a
#                          private one, and stops with the question for a public one

set -eu

SOURCE=${NAIMA_SOURCE:-https://github.com/naima-project/naima.git}
REF=${NAIMA_REF:-main}
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

# A host installed before the program was a git clone: a copy (carries .naima-copy.json)
# or a clone of the old full repository (its HEAD still holds naima/src/cli.ts).
is_legacy() {
  [ -f "$PROGRAM/.naima-copy.json" ] && return 0
  [ -d "$PROGRAM/.git" ] && git -C "$PROGRAM" cat-file -e HEAD:naima/src/cli.ts >/dev/null 2>&1
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
  say "  git add naima-tracker && git commit -m \"Migrate Naima to a git clone of the product\""
  say "  rm -rf $LEGACY     # once you have looked at what, if anything, you had changed in it"
}

next_steps() {
  cat <<EOF

Naima is installed in $ROOT.

Next:
  git add naima-tracker && git commit -m "Track this project with Naima"
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

  [ -e "$PROGRAM" ] || clone_naima
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
