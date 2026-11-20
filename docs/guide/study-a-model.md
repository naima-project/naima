# Study a model in the Models tab

The Models tab of `naima ui` lets you take an mCRL2 model of your project step by step: you play its environment, fire the steps it accepts, go back, branch,
and replay a recorded path or a counterexample. What you see is the model's own state, computed by the code naima-codegen generates from it, so nothing on
screen is a guess.

## What a model needs

A model appears in the tab once it has a _study_: a WebAssembly stepper built from its generated Rust code, and, if you want a picture of it, a view. You
declare the study in an mCRL2 file next to the model, in comments:

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

## Using the tab

- Open `naima ui`, then **Models** from Home's list. Pick a study.
- The line at the top is the path: the states taken, the past fading to the left, the current state as the orange disc, and the steps possible now on the right.
  Click one of those to take it, or click a past state to go back to it.
- **What happened** explains the last step and the model's own replies. **What may happen now** lists every step the model accepts in this state.
- The model's view, when it has one, sits below, and fires steps the same way.
- **Back** and **Forward** move along the path; firing from a past state starts a new branch and keeps the old one. **Undo** removes the last step you took.
  Steps recorded from a real run are never undone, only branched from.
- **Copy path** copies the path; **Load a path** takes one back, or a trace from the model checker, one step per line. A path loads up to the first step the
  model does not accept, and the tab says which step and why.
- **The state** shows every variable of the model, exactly as the model has it.
