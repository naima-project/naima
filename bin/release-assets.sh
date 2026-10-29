#!/bin/sh
# Build a release's assets: the source tree at the tag, and its SHA-256.
#
#   sh bin/release-assets.sh <version> [<repository>] [<out>]
#
# In <repository> (default: the current one), for the tag v<version>, writes
# into <out> (default: the current folder):
#
#   <name>-<version>.tar.gz          the files of the tag, made by git archive,
#                                     under one folder <name>-<version>/
#   <name>-<version>.tar.gz.sha256   its SHA-256, as sha256sum prints it
#
# <name> is the repository's folder name (naima, naima-stance-<name>,
# naima-codegen). The archive records the tag's commit, which installs check.
# Then it prints the command that uploads both to the release; it uploads
# nothing itself. What installs and updates do with them:
# docs/guide/update-naima.md.

set -eu

die() {
  printf 'release-assets: %s\n' "$*" >&2
  exit 1
}

VERSION=${1:-}
REPO=${2:-.}
OUT=${3:-.}
[ -n "$VERSION" ] || die "usage: sh bin/release-assets.sh <version> [<repository>] [<out>]"
VERSION=${VERSION#v}
TAG="v$VERSION"

TOP=$(git -C "$REPO" rev-parse --show-toplevel 2>/dev/null) || die "$REPO is not a git repository"
NAME=$(basename "$TOP")
git -C "$TOP" rev-parse --verify --quiet "refs/tags/$TAG^{commit}" >/dev/null || die "no tag $TAG in $TOP: tag the release first"
[ -z "$(git -C "$TOP" status --porcelain --untracked-files=no)" ] || say_dirty=1

mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
ARCHIVE="$NAME-$VERSION.tar.gz"
git -C "$TOP" -c core.autocrlf=false archive --format=tar --prefix="$NAME-$VERSION/" "$TAG" | gzip -9n >"$OUT/$ARCHIVE"

if command -v sha256sum >/dev/null 2>&1; then
  SUM=$(sha256sum "$OUT/$ARCHIVE" | cut -d' ' -f1)
elif command -v shasum >/dev/null 2>&1; then
  SUM=$(shasum -a 256 "$OUT/$ARCHIVE" | cut -d' ' -f1)
else
  die "neither sha256sum nor shasum is here to compute the checksum"
fi
printf '%s  %s\n' "$SUM" "$ARCHIVE" >"$OUT/$ARCHIVE.sha256"

COMMIT=$(git -C "$TOP" rev-parse "$TAG^{commit}")
printf 'wrote %s and %s.sha256: the files of %s (%s), SHA-256 %s\n' "$OUT/$ARCHIVE" "$OUT/$ARCHIVE" "$TAG" "$COMMIT" "$SUM"
if [ -n "${say_dirty:-}" ]; then printf 'note: the working tree has changes; the archive holds the tag alone, not them\n'; fi
printf 'upload them to the release: gh release upload %s "%s" "%s.sha256"\n' "$TAG" "$OUT/$ARCHIVE" "$OUT/$ARCHIVE"
