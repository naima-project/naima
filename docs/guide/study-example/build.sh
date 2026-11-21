#!/bin/sh
# Rebuilds the lock's study from its model, into build/:
#   1. generated/ from model/ and codegen.toml, with naima-codegen;
#   2. build/stepper.wasm from stepper/, for wasm32-unknown-unknown (it imports nothing);
#   3. build/view.js, build/observer.js and build/shared.js from view/, with Vite.
# naima-codegen is found as NAIMA_CODEGEN, or as naima-codegen on PATH.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
codegen=${NAIMA_CODEGEN:-naima-codegen}

"$codegen" generate --project "$here"
cargo build --manifest-path "$here/stepper/Cargo.toml" --release --target wasm32-unknown-unknown --lib
mkdir -p "$here/build"
cp "$here/stepper/target/wasm32-unknown-unknown/release/lock_stepper.wasm" "$here/build/stepper.wasm"
(cd "$here/view" && deno task build)
