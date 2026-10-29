---
title: Naima installs and updates only from releases, downloading each release's archive and checking its checksum
kind: behaviour-change
affects:
  - api
  - usage
  - data
commands:
  - changed update
  - changed rollback
  - changed init
  - changed stance
options:
  - added version
  - added sha256
action: Nothing to do for a project that follows Naima's releases. A project that runs a commit of main past the newest release, or follows a fork that publishes no releases, and wants to keep following main, runs naima update --main.
---

Each release of Naima now carries two assets, `naima-<version>.tar.gz` (the files of the release's tag) and its SHA-256, built by
`bin/release-assets.sh`. The installer downloads the newest release's archive, checks it, unpacks it into `naima-tracker/naima/` and makes
that folder a git clone at the tag's commit. `naima update` moves the lock only to releases: the newest one, or the version `--to` names, with
pre-releases only after `--pre` or when the project already runs one. It downloads the archive, refuses it when its checksum, or the commit
it was made from, does not match, and records `version` and `sha256` next to `commit` in `naima.json`. Without the network the lock stays
where it is and the update says why. A lock that still names a commit of main moves to the newest release on the next update, which says
so once; a commit of main that is already past the newest release stays until a newer release comes out. `--main` follows the source's main
as before, and so does a source that publishes no releases. GitHub counts each asset's downloads, so the releases page shows how many
installs and updates each version had, with no telemetry. `naima init` offers to add the topic `naima` to a public GitHub repository, for
the agent to ask the owner first, and `naima stance adopt` pins a stance's newest release, its archive verified, when the stance publishes
releases.
