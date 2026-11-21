# Study a model in the Models tab

The Models tab of `naima ui` lets you take an mCRL2 model of your project step by step: you play its environment, fire the steps it accepts, go back, branch,
and replay a recorded path or a counterexample. What you see is the model's own state, computed by the code naima-codegen generates from it, so nothing on
screen is a guess. In the same tab you can change the model, check its properties with mCRL2, replay the counterexample of a property that fails, generate
its Rust code and run the program built on it, without an agent.

## Every model opens

The tab lists every mCRL2 model of the project, grouped by folder, with no setup. A model is a naima-codegen project (a folder with a `codegen.toml`) or a
tracked `.mcrl2` file that is a whole specification, one with an `init`. Opening one gives the tab's usual cards: the path, what happened and what can happen,
paths and bookmarks, the state, the model's files, its properties with Check, and for a naima-codegen project its code with Generate.

A naima-codegen project is stepped through its generated TypeScript, which runs in a frame of its own with no access to the page or the network. Its states
and steps are the generated code's, and its labels are those of the refined system, so a counterexample of that system loads as it is. A plain specification
is explored by the server with mCRL2 (`naima model-explore`, under `naima run`) and stepped on the states found. Where the model is nondeterministic, a step
leads to every state that label reaches, and the state card shows each value that differs among them.

The properties listed are the `.mcf` files beside the model or in a `properties` folder next to it, and the property items that name the model or its system.
A counterexample found by Check is saved in the model's `paths` folder and replayed.

A model with more than 20,000 states is shown cut: the first 20,000 found from the start, nearest first. The tab says so. Explore more explores again to
twice the bound. On a state at the edge, whose steps were not explored, Explore from here explores on from that state and adds what it finds. Saving the
model, or generating its code again, explores it again, and the path you were on is replayed on the new states.

## The UI tab

A project that uses the UI stance can declare its app's machines in `stance-ui.json`:

```json
"tab": {
  "models": ["../develop/models/ui"],
  "generated": "src/logic/generated",
  "card": { "page": "dist/uicard.html", "build": ["deno", "task", "build"] }
}
```

The paths are relative to that file. The UI tab then lists the naima-codegen projects under those folders, and opens each like the Models tab does, with one
card more: the app itself, in the state the machine is in. The card is the page the project builds for it, which mounts the app on recorded data and walks
the machine along the path from its start, so what it shows is what the real code does in that state. Its controls work, and a step taken there is added
to the path. When the app asks for a step the model refuses in that state, the card says so above the app until you dismiss it. Naima's own UI declares
its machines this way, and a model that has no place in the app's `src/uicard/places.ts` opens without the app.

## A study of your own

A model can also have a declared _study_: a WebAssembly stepper built from its generated Rust code, and, if you want a picture of it, a view. You declare the
study in an mCRL2 file next to the model, in comments, and it takes the place of the model's default study:

```
%@ui begin
% title     The scheduler
% says      Give it a program and answer it.
% model     ../model/core.mcrl2
% stepper   build/stepper.wasm
% observer  build/observer.js
% view      build/view.js
% config    w=2
%@ui end
```

The same file holds the explanation of each kind of step, one line each, which the tab shows with every step:

```
%@say dispatch(x, n): "run this job" | "A worker is free and {x} is the oldest in the queue: it goes to the worker."
```

An agent writes the stepper's small wrapper, the observer and the view; the specification it follows is in the workshop's `develop/models-tab.md`. A line that
does not match the model (an action it does not have, the wrong number of arguments) is listed under the study with the reason, and not used.

To check, generate and run from the tab, the block also says where the study's properties and paths are, what the properties are checked on, and how the study
is built and its program run. The lock of the guide's example (`study-example/`) declares:

```
% paths      paths
% properties properties
% system     generated/model/systems/small-refined.mcrl2
% build      sh build.sh
% build-windows build.cmd
% run        cargo run --quiet --manifest-path driver/Cargo.toml
```

`properties` is a folder of `.mcf` files, each a modal mu-calculus formula. `system` is the mCRL2 specification they are checked on; for a model of
naima-codegen it is one of the systems it generates, which the tab generates again before each check, so the check sees the model as you saved it. `build` is
the command that builds the study again after a generation (the stepper and the view), and `run` the command that runs its program; `build-windows` and
`run-windows`, when given, are used on Windows instead. The commands run in the study's folder. Checking needs the `verifier-mcrl2` plugin on in `naima.json`
and the mCRL2 tools (`naima tools install mcrl2`); generating needs naima-codegen on your `PATH`, or named by `NAIMA_CODEGEN`.

## Using the tab

- Open `naima ui`, then **Models**, beside the date on Home or in the menu of Home's list. Pick a study. A note at the top says where to start; close it once
  you know.
- The study fills the window with cards, like a mosaic, and the page itself never scrolls. Drag the thin gap between two cards to give one more room. Drag a
  card by its title onto another card: onto its middle to swap the two, onto one of its edges to place it beside. Close a card with its cross and the others
  take its space; it waits above the mosaic, where a click opens it again. Maximise a card to the whole mosaic; Escape restores. The arrangement is kept for
  that study. The arrow keys do all of this too: on a gap they move it, on a card's title they swap it with its neighbour.
- **Timeline**: the states taken on a line, the past fading to the left, the current state as the orange disc, the steps possible now on the right. Click one of
  those to take it, or a past state to go back to it.
- **State machine explored**: every state reached on any road, once each, as a UML state machine diagram. The road you are on is solid; the roads you went back
  from are faded, dashed and drawn below; the steps possible now are dotted. Click any state to go there. On a state, the pin keeps it from fading and the star
  bookmarks it. Switch between horizontal and vertical layouts, zoom in and out, or fit.
- **What happened** explains the last step and the model's own replies, and lists your bookmarks. **What may happen now** lists every step the model accepts in
  this state. **The state** shows every variable of the model, exactly as the model has it.
- **The model's view**, when it has one, is a card too, or several cards, one per part of it,, and fires steps the same way. When it draws a standard diagram,
  such as a UML sequence diagram, it says so, and draws it in that standard's notation.
- **Back** and **Forward** move along the road; firing from a past state starts a new road and keeps the old one. **Previous** and **Next state seen** move over
  the states you visited, whatever road they are on. **Undo** removes the last step you took. Steps recorded from a real run are never undone, only branched
  from.
- **Copy path** copies the road; **Load a path** takes one back, or a trace from the model checker, one step per line. A path loads up to the first step the
  model does not accept, and the tab says which step and why. A path that is already one of your roads is shown on that road, not added again.
- A button you cannot use now is dimmed, and says why under its name.

## Changing, checking and running the model

Three cards wait in the row above the mosaic: **The model's files**, **Properties** and **Code**. A click opens one.

- **The model's files** lists the study's files, the mCRL2 specification first, then its own file, the other mCRL2 files, `codegen.toml`, the property formulas
  and the Rust code. Pick one and it opens in an editor that highlights mCRL2, Rust, TOML and the rest. Change it and press **Save** (or Ctrl-S, Cmd-S on a
  Mac): the file is written and the tab reads the study again. **Revert** goes back to the file as saved. Files that tools write (the generated code, the
  builds, the saved paths) are not listed.
- **Properties** lists the property files with what the last check said of each: holds, violated, or not checked yet. **Check all** checks every one with mCRL2,
  one after the other, and the card shows how far it is; a property's own button checks it alone. When a property is violated, mCRL2's counterexample (the
  steps that break it) is saved as a path in the study's `paths` folder, with a first line `% origin:` that says where it comes from, and replayed at once on
  the path card, a step a second. It stays in **Paths and bookmarks**, to replay again.
- **Code** has **Generate Rust**, which runs naima-codegen on the study and then its build command, so the tab steps the model as you changed it, and **Run the
  program**, which runs the study's program and shows what it prints as it prints it. **Stop** ends a job that runs too long.
- A check, a generation and a run work on the files as saved, one at a time: while the editor holds changes, or a job runs, they wait, and their buttons say
  so. The tab's own model, where this is checked, is in the workshop's `develop/models/ui/study/`.

The same checks run outside the tab with `naima model-check <specification> <property.mcf>... --paths <folder>`.

## For a study's own view

The widgets the tab is drawn with (the mosaic of cards, graphs laid out by themselves, the timeline, the UML sequence diagram) are a library a view imports as
`@naima/study/…`, from `naima-tracker/naima/src/plugins/verifier-mcrl2/widgets/` in your project. A view that draws a standard diagram declares it in the `%@ui`
block, with what it maps:

```
% diagrams  uml-sequence: the two parties, each step a message; directed-graph: the program's nodes
```
