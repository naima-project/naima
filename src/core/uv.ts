// uv, Astral's Python launcher and package manager, which runs naima-codegen (its launchers, naima-codegen and
// naima-codegen.cmd, call `uv run --project`): uv downloads the Python that naima-codegen pins and its libraries on first
// use, into the user's own folders, so a machine needs no Python. Naima installs uv per user, never with administrator
// rights, from the release archive pinned here with its checksum; the launchers find it from NAIMA_UV.

import { installedProgram } from "./tools.ts"

const RELEASE = "https://github.com/astral-sh/uv/releases/download/0.11.7"

/** uv 0.11.7, from Astral's release archives. */
export const UV = {
  name: "uv",
  title: "uv (Astral)",
  says: "the program that runs naima-codegen: it fetches the Python naima-codegen pins and its libraries by itself, so a machine needs no Python",
  version: "0.11.7",
  licence: "MIT OR Apache-2.0",
  homepage: "https://docs.astral.sh/uv/",
  source: "https://github.com/astral-sh/uv",
  authors: ["Astral"],
  programs: ["uv"],
  verify: { program: "uv", args: ["--version"], expect: "uv 0.11.7" },
  platforms: {
    "darwin-arm64": {
      url: `${RELEASE}/uv-aarch64-apple-darwin.tar.gz`,
      size: 20839135,
      sha256: "66e37d91f839e12481d7b932a1eccbfe732560f42c1cfb89faddfa2454534ba8",
      format: "tar.gz",
      bin: "uv-aarch64-apple-darwin",
    },
    "darwin-x64": {
      url: `${RELEASE}/uv-x86_64-apple-darwin.tar.gz`,
      size: 22522163,
      sha256: "0a4bc8fcde4974ea3560be21772aeecab600a6f43fa6e58169f9fa7b3b71d302",
      format: "tar.gz",
      bin: "uv-x86_64-apple-darwin",
    },
    "linux-x64": {
      url: `${RELEASE}/uv-x86_64-unknown-linux-gnu.tar.gz`,
      size: 24249861,
      sha256: "6681d691eb7f9c00ac6a3af54252f7ab29ae72f0c8f95bdc7f9d1401c23ea868",
      format: "tar.gz",
      bin: "uv-x86_64-unknown-linux-gnu",
    },
    "linux-arm64": {
      url: `${RELEASE}/uv-aarch64-unknown-linux-gnu.tar.gz`,
      size: 22739428,
      sha256: "f2ee1cde9aabb4c6e43bd3f341dadaf42189a54e001e521346dc31547310e284",
      format: "tar.gz",
      bin: "uv-aarch64-unknown-linux-gnu",
    },
    "windows-x64": {
      url: `${RELEASE}/uv-x86_64-pc-windows-msvc.zip`,
      size: 23572531,
      sha256: "fe0c7815acf4fc45f8a5eff58ed3cf7ae2e15c3cf1dceadbd10c816ec1690cc1",
      format: "zip",
      bin: "",
    },
  },
}

/** The installed uv's program on this machine (`naima tools install uv`), or null. */
export const installedUv = (): string | null => installedProgram(UV as never, "uv")
