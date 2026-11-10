---
title: naima ui opens the desktop app on the project, and --install-desktop builds and installs it on macOS
kind: feature
affects:
  - usage
---

`naima ui` opens the installed desktop app on the project, or brings forward its window already open there, and goes to the browser with `--browser`, when the
app is not installed (on macOS with a hint) or when it cannot start. `naima ui --install-desktop` builds the app on macOS from the Tauri shell the product now
ships in `ui/desktop`, and installs it as Naima.app in the user's Applications folder, reporting its progress. The app also takes its project from its first
argument. The guide The Naima window (docs/guide/the-window.md) describes both.
