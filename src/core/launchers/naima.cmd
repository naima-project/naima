@echo off
rem Naima's launcher for cmd, committed with the project in its tracker folder: it runs naima.ps1 beside it,
rem which repairs a missing Deno or program and then runs Naima. Written by naima init and naima update from
rem the program's src/core/launchers/naima.cmd: never edit it here.
rem   naima-tracker\naima.cmd COMMAND ARGUMENTS
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0naima.ps1" %*
exit /b %ERRORLEVEL%
