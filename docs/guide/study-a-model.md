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
- The study is a set of cards. Move a card by its title (drag it, or use the arrow keys on it), make it wider, narrower, taller or shorter with the buttons on
  its bar, fold it, or maximise it to the whole window (Escape restores). The arrangement is kept for that study. A card never grows: what it holds scrolls,
  pans or zooms inside it.
- **Timeline**: the states taken on a line, the past fading to the left, the current state as the orange disc, the steps possible now on the right. Click one of
  those to take it, or a past state to go back to it.
- **State machine explored**: every state reached on any road, once each, as a UML state machine diagram. The road you are on is solid; the roads you went back
  from are faded, dashed and drawn below; the steps possible now are dotted. Click any state to go there. On a state, the pin keeps it from fading and the star
  bookmarks it. Switch between horizontal and vertical layouts, zoom in and out, or fit.
- **What happened** explains the last step and the model's own replies, and lists your bookmarks. **What may happen now** lists every step the model accepts in
  this state. **The state** shows every variable of the model, exactly as the model has it.
- **The model's view**, when it has one, is a card too, and fires steps the same way. When it draws a standard diagram, such as a UML sequence diagram, it says
  so, and draws it in that standard's notation.
- **Back** and **Forward** move along the road; firing from a past state starts a new road and keeps the old one. **Previous** and **Next state seen** move over
  the states you visited, whatever road they are on. **Undo** removes the last step you took. Steps recorded from a real run are never undone, only branched
  from.
- **Copy path** copies the road; **Load a path** takes one back, or a trace from the model checker, one step per line. A path loads up to the first step the
  model does not accept, and the tab says which step and why.

## For a study's own view

The widgets the tab is drawn with (the bento, graphs laid out by themselves, the timeline, the UML sequence diagram) are a library a view imports as
`@naima/study/…`, from `naima-tracker/naima/src/plugins/verifier-mcrl2/widgets/` in your project. A view that draws a standard diagram declares it in the `%@ui`
block, with what it maps:

```
% diagrams  uml-sequence: the two parties, each step a message; directed-graph: the program's nodes
```
