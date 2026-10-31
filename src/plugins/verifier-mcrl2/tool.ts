// The mCRL2 toolset this plugin needs, pinned to release 202607.0, as `naima
// tools install mcrl2` installs it (specs/tools-plugin-declares-tools-needs-naima-tools,
// §8). The sizes and sha256 are the release's own, as GitHub publishes them for
// https://github.com/mCRL2org/mCRL2/releases/tag/mcrl2-202607.0.
//
// The tools point belongs to the tools plugin, and plugins never import each
// other: the shape is the one its contract declares.

const RELEASE = "https://github.com/mCRL2org/mCRL2/releases/download/mcrl2-202607.0"

export const MCRL2 = {
  name: "mcrl2",
  title: "mCRL2 toolset",
  says: "the mCRL2 toolset: linearisation, PBES solving and state-space tools, used by the mcrl2 verifier",
  version: "202607.0",
  licence: "BSL-1.0",
  homepage: "https://www.mcrl2.org",
  source: "https://github.com/mCRL2org/mCRL2",
  authors: ["the mCRL2 team at Eindhoven University of Technology"],
  programs: ["mcrl22lps", "lps2pbes", "pbessolve", "lps2lts", "ltsinfo", "ltsconvert", "lts2pbes", "ltscompare", "lpspp"],
  verify: { program: "mcrl22lps", args: ["--version"], expect: "202607.0" },
  platforms: {
    "darwin-arm64": {
      url: `${RELEASE}/mcrl2-202607.0_arm64.dmg`,
      size: 42971769,
      sha256: "e584919454b0d774800eff964f19dad2e0a0eac91e571f788aae4ab1a87a207f",
      unpacked: 125259776,
      format: "dmg",
      app: "mCRL2.app",
      bin: "mCRL2.app/Contents/bin",
    },
    "darwin-x64": {
      url: `${RELEASE}/mcrl2-202607.0_x86_64.dmg`,
      size: 43777805,
      sha256: "70b0804413e52a5b44c5165c066273f777598ec9b9ae4054770de18472221093",
      format: "dmg",
      app: "mCRL2.app",
      bin: "mCRL2.app/Contents/bin",
    },
    "linux-x64": {
      // Published as system packages only; the .deb is unpacked, not installed: its programs find their
      // libraries through $ORIGIN/../lib, and need the system's glibc 2.38 and libstdc++ 13 or later.
      url: `${RELEASE}/mcrl2-202607.0_x86_64.deb`,
      size: 27921814,
      sha256: "00cb4c347638b3a418fb67c9d67b8d2bf2245e10d4affa4cd993b1c357bde969",
      unpacked: 84770816,
      format: "deb",
      bin: "usr/bin",
    },
    "linux-arm64": {
      unavailable:
        "mCRL2 202607.0 publishes no Linux arm64 build, and building it from source is not shipped — run mCRL2 work on a macOS, Linux x86_64 or Windows host",
    },
    "windows-x64": {
      url: `${RELEASE}/mcrl2-202607.0_x86_64.zip`,
      size: 127303774,
      sha256: "52c6ea923cc0fff209f8fdfeb0ccf435be80de0dc3f2e786547b399a0d7681d9",
      unpacked: 784389286,
      format: "zip",
      bin: "mcrl2-202607.0_AMD64/bin",
    },
  },
}
