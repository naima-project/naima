// The CPython Naima installs for the programs that are written in Python (Storm's stormpy; naima-codegen for the Models
// tab): a python-build-standalone build, run from its own directory, so that neither depends on the system's Python,
// which may be missing (Windows has a stub that only opens the Store), too old, or a uv-managed one that a ssh session
// on Windows cannot reach (its junctions are untrusted mount points there).

import { installedProgram } from "./tools.ts"

const PBS = "https://github.com/astral-sh/python-build-standalone/releases/download/20261003"

/** CPython 3.13.16, python-build-standalone build 20261003: the Python stormpy's venv is made with. */
export const PYTHON = {
  name: "python",
  title: "CPython (python-build-standalone)",
  says: "a CPython built to run from any directory, so that Python tools such as Storm do not depend on the system's Python",
  version: "3.13.16+20261003",
  licence: "PSF-2.0 (CPython; the build bundles OpenSSL, SQLite, Tcl/Tk and others under their own licences)",
  homepage: "https://github.com/astral-sh/python-build-standalone",
  source: "https://github.com/astral-sh/python-build-standalone",
  authors: ["Astral", "the CPython developers"],
  programs: ["python"],
  verify: { program: "python", args: ["--version"], expect: "Python 3.13.16" },
  platforms: {
    "darwin-arm64": {
      url: `${PBS}/cpython-3.13.16%2B20261003-aarch64-apple-darwin-install_only_stripped.tar.gz`,
      size: 25246115,
      sha256: "9e01f63bbb08576cd9c8bc2d0564d098cb30c8453a0cd4bcf6aef458f6d2a147",
      unpacked: 68435968,
      format: "tar.gz",
      bin: "python/bin",
    },
    "darwin-x64": {
      url: `${PBS}/cpython-3.13.16%2B20261003-x86_64-apple-darwin-install_only_stripped.tar.gz`,
      size: 24964084,
      sha256: "b4dad38ba6a344555ccb71a1b08caad0a6c0dda88c5803658bc95bd7f04e9f5c",
      format: "tar.gz",
      bin: "python/bin",
    },
    "linux-x64": {
      url: `${PBS}/cpython-3.13.16%2B20261003-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz`,
      size: 35076205,
      sha256: "4595c5589fff7bf0cb158d9a88a797e0d791fa33830770fcb7bf3f4b104feeae",
      format: "tar.gz",
      bin: "python/bin",
    },
    "linux-arm64": {
      url: `${PBS}/cpython-3.13.16%2B20261003-aarch64-unknown-linux-gnu-install_only_stripped.tar.gz`,
      size: 29316850,
      sha256: "6e9641400f8debd9b7924b27b5ff0662c372852382e291a76c450c7b67414cf6",
      format: "tar.gz",
      bin: "python/bin",
    },
    "windows-x64": {
      url: `${PBS}/cpython-3.13.16%2B20261003-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`,
      size: 21970131,
      sha256: "ec43f1a85c29f147d7ae2d13218c52c70b24a983a82ab22d6c607c0593060e10",
      format: "tar.gz",
      bin: "python",
    },
  },
}

/** The installed Python's program on this machine (`naima tools install python`), or null. */
export const installedPython = (): string | null => installedProgram(PYTHON as never, "python")
