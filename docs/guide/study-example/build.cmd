@echo off
rem Rebuilds the lock's study from its model, into build\ (the same steps as build.sh):
rem   1. generated\ from model\ and codegen.toml, with naima-codegen;
rem   2. build\stepper.wasm from stepper\, for wasm32-unknown-unknown (it imports nothing);
rem   3. build\view.js, build\observer.js and build\shared.js from view\, with Vite.
rem naima-codegen is found as NAIMA_CODEGEN, or as naima-codegen on PATH.
setlocal
set "here=%~dp0"
if "%NAIMA_CODEGEN%"=="" (set "codegen=naima-codegen") else (set "codegen=%NAIMA_CODEGEN%")

call "%codegen%" generate --project "%here%." || exit /b 1
cargo build --manifest-path "%here%stepper\Cargo.toml" --release --target wasm32-unknown-unknown --lib || exit /b 1
if not exist "%here%build" mkdir "%here%build"
copy /y "%here%stepper\target\wasm32-unknown-unknown\release\lock_stepper.wasm" "%here%build\stepper.wasm" >nul || exit /b 1
pushd "%here%view"
call deno task build
set "status=%errorlevel%"
popd
exit /b %status%
