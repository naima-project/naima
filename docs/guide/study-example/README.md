# A study by hand: the lock

A worked example for [Write a study by hand](../write-a-study-by-hand.md): a lock shared by three clients, as an mCRL2 model, made into a study that Naima's
Models tab opens. In the tab you are the clients and the lock answers you.

The files, in the order you read them:

| file                                  | what it is                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `model/core.mcrl2`                    | the lock, one linear process `Core` in naima-codegen's form: two inputs, `ask` and `release`, one output, `grant` |
| `model/codegen-init.mcrl2`            | the initial state: every client idle, nobody waiting, the lock free                                               |
| `model/policy.toml`                   | the order of the outputs; the lock leaves nothing else open                                                       |
| `codegen.toml`                        | the parameters with their roles, the actions with their kinds, and the Rust crate to generate                     |
| `model/env.mcrl2`                     | the clients, as the environment the checks compose with `Core`                                                    |
| `model/observers.mcrl2`               | invariants for the checks: never two holders, never free while someone holds it                                   |
| `model/instances/three.mcrl2`         | the one instance the checks run on                                                                                |
| `generated/`                          | what naima-codegen writes from the files above, including the Rust crate `generated/rust/lock/`; never edited     |
| `stepper/src/lib.rs`                  | the stepper interface, version 1, on top of the generated crate, with its tests                                   |
| `stepper/Cargo.toml`                  | the stepper's crate, a workspace of its own, built for `wasm32-unknown-unknown`                                   |
| `study.mcrl2`                         | the study's declaration (`%@ui`) and the explanation of every kind of step (`%@say`)                              |
| `view/src/types.ts`                   | what the tab gives the view and the observer                                                                      |
| `view/src/observer.svelte.ts`         | the observer: who holds the lock, who waits, and how long each client waited, in steps                            |
| `view/src/View.svelte`                | the view: buttons for each client, a UML state machine per client, and a UML sequence diagram                     |
| `view/src/view.ts`                    | the module the tab loads, `mount(target, host)`                                                                   |
| `view/vite.config.ts`                 | the build of `view.js` and `observer.js`, with the alias to Naima's widget library                                |
| `view/package.json`, `view/deno.json` | the view's packages and its `build` task                                                                          |
| `build.sh`, `build.cmd`               | rebuild everything from the model                                                                                 |
| `build/`                              | what the tab loads: `stepper.wasm`, `view.js`, `observer.js` and `shared.js`                                      |

To rebuild, with naima-codegen on your `PATH` or named by `NAIMA_CODEGEN`:

```sh
sh build.sh
```
