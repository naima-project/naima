---
title: Installs and updates take only releases from 1.1.0-beta.4 on, and an update that moves the program finishes under that program's own launcher
kind: fix
affects:
  - usage
commands:
  - changed update
action: Nothing to do. A project that wants a release older than 1.1.0-beta.4 names it, with naima update --to or NAIMA_VERSION. An update started by a Naima from before releases that stops saying to run the command again is finished by running naima update once more.
---

A fresh install took v1.0.0, the newest stable release, whose files are laid out the way Naima was before releases were installed from archives, and failed
right after unpacking it. The installers (`install.sh`, `install.ps1`) and `naima update` now look only at releases from `1.1.0-beta.4` on, the first one built
for archive installs, and take the newest of them. Pre-releases are skipped only when a stable release from `1.1.0-beta.4` on exists (and `naima
update` still
takes them with `--pre`, or when the project already runs one); while no such stable release exists, the newest pre-release is installed. The installers read
the list from the releases API (`NAIMA_RELEASES_API`, GitHub's by default) instead of GitHub's `latest` page, which never names a pre-release. A version named
with `NAIMA_VERSION` or `naima update --to` is installed as named.

An update whose lock names a commit of main past the newest release now decides to stay before downloading anything. When an update moves the program to another
commit, the launcher hands the rest of the run to that commit's own launcher, so the new program runs with the permissions its own launcher grants, such as the
hosts a release is downloaded from. A launcher from before releases cannot do that: the download it refuses is now reported as the launcher refusing the host,
with the advice to run the command again, instead of Deno's own message about `--allow-net`.
