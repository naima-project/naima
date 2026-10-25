---
title: Function and complexity measures work on Rust
kind: feature
affects:
  - api
  - usage
---

The code measures that read functions (`code.functions`, `code.function-size`
and `code.complexity`, with their `-max` presets) now work on Rust files as
well as TypeScript and JavaScript. Naima finds `fn` items, methods and
closures, and counts `if`, `while`, `for`, each `match` arm after the first,
`?`, `let … else`, `&&` and `||`. Its comment reading for Rust now handles
nested block comments, raw strings, char literals and lifetimes, so lines of
code and duplication on Rust can change slightly. A language contributed to
`code-languages` may now bring its own `strip(text)` when the generic comment
scan cannot read it. No Rust compiler is needed.
