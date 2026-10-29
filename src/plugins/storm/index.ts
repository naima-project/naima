// Storm, the probabilistic model checker, made available to a project through
// its Python package stormpy, in a venv inside Naima's own tools directory, on
// a Python Naima ships too (specs/tools-plugin-declares-tools-needs-naima-tools,
// §8). This plugin declares the two tools; `naima tools path storm python`
// prints the venv's Python for a project's scripts. The Storm verifier is its
// own feature.
//
// Sizes and sha256 are those PyPI and the python-build-standalone release
// publish. The tools point belongs to the tools plugin, and plugins never
// import each other: the shape is the one its contract declares.

import { CONTRACT, type Plugin } from "../../core/api.ts"

const PBS = "https://github.com/astral-sh/python-build-standalone/releases/download/20261003"
const PYPI = "https://pypi.org/simple (stormpy 1.14.0, deprecated 3.0.0, wrapt 2.5.0; binary wheels, hash-checked)"

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

/** Storm, through stormpy 1.14.0 and its two dependencies, pinned with their hashes, in a venv of PYTHON. */
export const STORM = {
  name: "storm",
  title: "Storm (stormpy)",
  says: "the Storm probabilistic model checker, through its Python package stormpy, in a venv: import stormpy from its python",
  version: "1.14.0",
  licence: "GPL-3.0-only (stormpy and Storm; its dependencies Deprecated MIT, wrapt BSD-2-Clause)",
  homepage: "https://www.stormchecker.org",
  source: "https://github.com/moves-rwth/stormpy",
  authors: ["the Storm team at RWTH Aachen University"],
  needs: ["python"],
  programs: ["python"],
  verify: {
    program: "python",
    args: ["-c", "import stormpy, importlib.metadata as m; print('stormpy', m.version('stormpy'))"],
    expect: "stormpy 1.14.0",
  },
  platforms: {
    "darwin-arm64": {
      // stormpy-1.14.0-cp313-cp313-macosx_14_0_arm64.whl
      url: PYPI,
      size: 36947903,
      format: "pip",
      python: "python",
      bin: "venv/bin",
      requirements: [
        "stormpy==1.14.0 --hash=sha256:671161c38a519939dc547075512038dbaf5d9ebf35393fdfe4e3c48d35082423",
        "deprecated==3.0.0 --hash=sha256:58204cf4a7f6270d547af5c278ee7a6bb56045a4b3d8441a1cd11660f41b7939",
        "wrapt==2.5.0 --hash=sha256:c57ddae24cf72eb6bd18112638a987cafe6109d90f2df111e6934362cc03ac1a --hash=sha256:107eea1a511e98a3a5033b0c2cb403fbb37f05dee6ac1fb85c0460d311ec278c",
      ],
    },
    "darwin-x64": {
      // stormpy-1.14.0-cp313-cp313-macosx_15_0_x86_64.whl
      url: PYPI,
      size: 39147763,
      format: "pip",
      python: "python",
      bin: "venv/bin",
      requirements: [
        "stormpy==1.14.0 --hash=sha256:190b7115f73930e3b6d36e11f6794bd2a1dde51e02eec552499743d8c1f04d97",
        "deprecated==3.0.0 --hash=sha256:58204cf4a7f6270d547af5c278ee7a6bb56045a4b3d8441a1cd11660f41b7939",
        "wrapt==2.5.0 --hash=sha256:b312b3cc87951faaed3cfef984d768ee8bee7f935d9cc929aaa9946b0b96a98c --hash=sha256:107eea1a511e98a3a5033b0c2cb403fbb37f05dee6ac1fb85c0460d311ec278c",
      ],
    },
    "linux-x64": {
      // stormpy-1.14.0-cp313-cp313-manylinux_2_34_x86_64.whl
      url: PYPI,
      size: 51595588,
      format: "pip",
      python: "python",
      bin: "venv/bin",
      requirements: [
        "stormpy==1.14.0 --hash=sha256:a4ad300dde7b26ce995a750aa1c2363713f5e1a34d3e6d276a0e9d34512676da",
        "deprecated==3.0.0 --hash=sha256:58204cf4a7f6270d547af5c278ee7a6bb56045a4b3d8441a1cd11660f41b7939",
        "wrapt==2.5.0 --hash=sha256:b95a6eca3b927853529eea958310563c83140ae8451dd5dc4399c7da385dc4f3 --hash=sha256:107eea1a511e98a3a5033b0c2cb403fbb37f05dee6ac1fb85c0460d311ec278c",
      ],
    },
    "linux-arm64": {
      // stormpy-1.14.0-cp313-cp313-manylinux_2_34_aarch64.whl
      url: PYPI,
      size: 47654494,
      format: "pip",
      python: "python",
      bin: "venv/bin",
      requirements: [
        "stormpy==1.14.0 --hash=sha256:2a40412d900f2439cbdea083573829e617da5fb6e7887eccd6a62f3ad516f702",
        "deprecated==3.0.0 --hash=sha256:58204cf4a7f6270d547af5c278ee7a6bb56045a4b3d8441a1cd11660f41b7939",
        "wrapt==2.5.0 --hash=sha256:6058e12e9caa33468f9a36fb88c15a4bb30a479f997b37834b83abdbf062f264 --hash=sha256:107eea1a511e98a3a5033b0c2cb403fbb37f05dee6ac1fb85c0460d311ec278c",
      ],
    },
    "windows-x64": {
      unavailable:
        "stormpy 1.14.0 publishes no Windows build; reaching Storm through a Linux environment (WSL) behind this plugin is not built yet, and turning WSL on needs administrator rights — run Storm work on a macOS or Linux host: naima tools install storm --host <host>",
    },
  },
}

export default function storm(): Plugin {
  return {
    name: "storm",
    contract: CONTRACT,
    says: "Storm, the probabilistic model checker, installed by naima tools through its Python package stormpy, on a Python Naima ships",
    about:
      "Off until `naima.json` names it under `plugins`, since installing it runs programs. Contributes two tools: `python`, CPython 3.13.16 from python-build-standalone, and `storm`, stormpy 1.14.0 with its dependencies, pinned with their hashes, in a venv of that Python. " +
      "`naima tools install storm` installs both, with consent; `naima tools path storm python` prints the venv's Python, which imports stormpy. " +
      "stormpy publishes wheels for macOS (arm64 on macOS 14 or later, x86_64 on macOS 15 or later) and Linux (glibc 2.34 or later), none for Windows: there, `naima tools` says so and what to do.",
    contributes: { tools: [PYTHON, STORM] },
    optional: ["tools"],
  }
}
