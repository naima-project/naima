// Node and Bun, the JavaScript runtimes a TypeScript project's tests run on
// besides Deno, declared as tools so that `naima tools install` can put either
// on a machine, this one or a declared host, without touching PATH
// (specs/tools-plugin-declares-tools-needs-naima-tools). Node runs TypeScript
// through its type stripping, on by default from 22.18; the version declared
// is later.
//
// Sizes are those the download servers report; sha256 are those each release
// publishes in its SHASUMS256.txt. The tools point belongs to the tools
// plugin, and plugins never import each other: the shape is the one its
// contract declares.

import { CONTRACT, type Plugin } from "../../core/api.ts"

const NODE_DIST = "https://nodejs.org/dist/v24.22.2"
const BUN_RELEASE = "https://github.com/oven-sh/bun/releases/download/bun-v1.4.4"

/** The oldest Node whose type stripping runs a TypeScript test file without a flag. */
export const NODE_MINIMUM = "22.18.0"

/** Node.js 24.22.2, an LTS release: the official archive of each platform (SHASUMS256.txt of the release). */
export const NODE = {
  name: "node",
  title: "Node.js",
  says: "the JavaScript runtime, 22.18 or later so that its type stripping runs TypeScript: a project's tests run on it besides Deno",
  version: "24.22.2",
  licence: "MIT (Node.js; the archive bundles V8, libuv, OpenSSL, npm and others under their own licences)",
  homepage: "https://nodejs.org",
  source: "https://github.com/nodejs/node",
  authors: ["the Node.js contributors", "OpenJS Foundation"],
  programs: ["node"],
  verify: { program: "node", args: ["--version"], expect: "v24.22.2" },
  platforms: {
    "darwin-arm64": {
      url: `${NODE_DIST}/node-v24.22.2-darwin-arm64.tar.gz`,
      size: 53068959,
      sha256: "aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a",
      format: "tar.gz",
      bin: "node-v24.22.2-darwin-arm64/bin",
    },
    "darwin-x64": {
      url: `${NODE_DIST}/node-v24.22.2-darwin-x64.tar.gz`,
      size: 54383415,
      sha256: "d5e336d588c45be0c37dbd52cc29895593009ca4997a77a1fd02815131ed0e52",
      format: "tar.gz",
      bin: "node-v24.22.2-darwin-x64/bin",
    },
    "linux-x64": {
      url: `${NODE_DIST}/node-v24.22.2-linux-x64.tar.gz`,
      size: 58299872,
      sha256: "361718c444e49af2ca5a110c83ba6a8901143f23ab285ebbef0341f391f482a9",
      format: "tar.gz",
      bin: "node-v24.22.2-linux-x64/bin",
    },
    "linux-arm64": {
      url: `${NODE_DIST}/node-v24.22.2-linux-arm64.tar.gz`,
      size: 58030966,
      sha256: "95c264150aceb7f3437a29fd6984924f5f8d1511ea3cbd6c508b83f6c555dae2",
      format: "tar.gz",
      bin: "node-v24.22.2-linux-arm64/bin",
    },
    "windows-x64": {
      url: `${NODE_DIST}/node-v24.22.2-win-x64.zip`,
      size: 37754834,
      sha256: "ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2",
      format: "zip",
      bin: "node-v24.22.2-win-x64",
    },
  },
}

/** Bun 1.4.4: the release archive of each platform (SHASUMS256.txt of the release). */
export const BUN = {
  name: "bun",
  title: "Bun",
  says: "the JavaScript runtime and test runner: a project's tests run on it besides Deno, with bun test",
  version: "1.4.4",
  licence: "MIT (Bun; the binary bundles JavaScriptCore, under LGPL-2.1, and others under their own licences)",
  homepage: "https://bun.sh",
  source: "https://github.com/oven-sh/bun",
  authors: ["Oven"],
  programs: ["bun"],
  verify: { program: "bun", args: ["--version"], expect: "1.4.4" },
  platforms: {
    "darwin-arm64": {
      url: `${BUN_RELEASE}/bun-darwin-aarch64.zip`,
      size: 40323673,
      sha256: "c240d7f0ccb90c263a849fcdb09b7ee62630d921348ed6aafda86b9d577bc510",
      format: "zip",
      bin: "bun-darwin-aarch64",
    },
    "darwin-x64": {
      url: `${BUN_RELEASE}/bun-darwin-x64.zip`,
      size: 43442571,
      sha256: "50a3491f73abc2fe81673171a85762d3bc2cc1680ccecadd983de99adf77977e",
      format: "zip",
      bin: "bun-darwin-x64",
    },
    "linux-x64": {
      url: `${BUN_RELEASE}/bun-linux-x64.zip`,
      size: 51794595,
      sha256: "bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c",
      format: "zip",
      bin: "bun-linux-x64",
    },
    "linux-arm64": {
      url: `${BUN_RELEASE}/bun-linux-aarch64.zip`,
      size: 51644673,
      sha256: "baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e",
      format: "zip",
      bin: "bun-linux-aarch64",
    },
    "windows-x64": {
      url: `${BUN_RELEASE}/bun-windows-x64.zip`,
      size: 54731706,
      sha256: "cd2c0fccc78f3ede1f50ca827a15f063eda13d4d150a3d0674f4f6e323d864a5",
      format: "zip",
      bin: "bun-windows-x64",
    },
  },
}

export default function runtimes(): Plugin {
  return {
    name: "runtimes",
    contract: CONTRACT,
    says: "Node and Bun, the JavaScript runtimes a project's tests run on besides Deno, installed by naima tools",
    about:
      "Off until `naima.json` names it under `plugins`, since installing a tool runs programs. Contributes two tools: `node`, Node.js 24.22.2 (22.18 or later runs TypeScript through its type stripping), and `bun`, Bun 1.4.4, each the official archive of its platform, its sha256 the one the release publishes. " +
      "`naima tools install node` and `naima tools install bun` install them, with consent, on this machine or with `--host` on a declared one; `naima tools path node` and `naima tools path bun` print the installed program. " +
      "Both publish builds for macOS (arm64, x86_64), Linux (x86_64, arm64) and Windows (x86_64); Bun's x86_64 builds need a processor with AVX2.",
    contributes: { tools: [NODE, BUN] },
    optional: ["tools"],
  }
}
