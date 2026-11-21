# Write a study by hand

A study is what lets the Models tab open an mCRL2 model: a stepper that runs the model, a declaration that names it, and, if you want a picture, an observer and
a view. [Study a model in the Models tab](study-a-model.md) shows how to use one. This page shows how to build one yourself, with no agent, following a small
worked example that ships with Naima in [`study-example/`](study-example/README.md).

The example is the classic mutual exclusion lock. Three clients share one lock. A client asks for it when it is idle, the lock grants it to the client that has
waited longest once it is free, and the holder lets it go when it is done. In the tab you play the clients and the lock answers.

You need the mCRL2 toolset at the version `codegen.toml` names, naima-codegen, Rust with the `wasm32-unknown-unknown` target
(`rustup target add wasm32-unknown-unknown`), and Deno. Each step below names the files of the example it uses, so you can read them side by side.

## 1. Write the model in naima-codegen's form

naima-codegen turns a model into code only when the model is one linear process called `Core`. Every summand of `Core` has a condition, exactly one action, and
a recursive call that says which parameters change. Before each summand goes a tag line. `%@input` marks what the environment says to the model, and
`%@order <level>` marks what the model decides by itself. Every action of `Core` starts with `c_`.

Here is the lock, from `model/core.mcrl2`:

```
sort Client = struct c1 | c2 | c3;              % the clients
sort Phase = struct IDLE | WAITING | HOLDING;   % where a client stands

act  c_ask, c_release: Client;                  % inputs, from the clients
     c_grant: Client;                           % the lock's own output

% phase: each client's phase; queue: the clients waiting, the longest first;
% free: nobody holds the lock
proc Core(phase: Client -> Phase, queue: List(Client), free: Bool) =
% ---- inputs: the clients
%@input
    sum c: Client . (phase(c) == IDLE) ->
      c_ask(c) . Core(phase = phase[c -> WAITING], queue = queue <| c)
%@input
  + sum c: Client . (phase(c) == HOLDING) ->
      c_release(c) . Core(phase = phase[c -> IDLE], free = true)

% ---- outputs: the lock's decision
%@order 1
  + sum c: Client . (free && queue != [] && c == head(queue)) ->
      c_grant(c) . Core(phase = phase[c -> HOLDING], queue = tail(queue), free = false)

%@observers
  + delta;
```

The output names its client through the condition `c == head(queue)`, so the generated code never has to choose one. When a model leaves a choice open, the
policy says how the code takes it. The lock has nothing left open, so its `model/policy.toml` only lists the outputs in order of priority:

```toml
order = ["c_grant"]
```

The rest of the model folder holds what naima-codegen reads besides `core.mcrl2`. `codegen-init.mcrl2` gives the initial state. `env.mcrl2` is the environment,
the clients, written freely with `e_` actions, and composed with `Core` so that `c_ask | e_ask` becomes the action `ask`. `instances/three.mcrl2` is the one
instance the checks run on, and `observers.mcrl2` states invariants, such as that no two clients ever hold the lock at once.

`codegen.toml` lists each parameter of `Core` with its role and each action with its kind:

```toml
[project]
backends = ["rust"]
rust_crate = "lock"

# phase is a function over an enumeration (Client), so its role is a table.
[[parameter]]
name = "phase"
role = "table"
```

The full rules of the form are in naima-codegen's `docs/spec.md`, sections 3.5 to 3.7.

## 2. Generate the Rust code

From the example folder:

```sh
naima-codegen generate --project .
naima-codegen check-refinement --project .
```

The first command writes `generated/`, including the Rust crate `generated/rust/lock/`. Never edit what it writes. Change the model and generate again. The
second command checks that the generated code stays inside the model and that the invariants hold. For the lock the systems it explores have a few dozen states,
and it reports that every check holds.

The crate gives you a `State` with `new` and `step`, the events (`Event::Ask(Client)`, `Event::Release(Client)`), the outputs (`Action::Grant(Client)`) and the
state's fields (`phase`, `queue`, `free`). After each input it takes its own outputs until it has nothing left to do, so one input and its replies are one step.

## 3. Wrap it in the stepper interface

The tab does not know your model. It talks to a WebAssembly module that exports a few functions with fixed names, the stepper interface, version 1. The wrapper
in `stepper/src/lib.rs` implements them on top of the generated crate. It decides nothing about the lock; it only translates.

Every function that answers writes a JSON text into one output buffer and returns 1 when it succeeded, 0 when it did not. The host reads the buffer with
`naima_out_ptr` and `naima_out_len`. To pass an argument, the host asks for a buffer with `naima_alloc(len)`, writes the bytes into it, and gives it back with
`naima_free(ptr, len)`.

The exports, one by one:

- `naima_abi()` returns 1, the version of the interface.
- `naima_describe()` answers the description: the inputs, the outputs, the environment's own actions, the configuration and the state's parameters with their
  sorts. The lock has no configuration and no environment action such as time, so both lists are empty.
- `naima_init(ptr, len)` makes the initial state. Its argument is the configuration as a JSON object. It answers `{"ok":true,"outputs":[…]}` with the outputs
  the model took at once.
- `naima_step(ptr, len, dry)` takes an input given by its label, such as `ask(c1)`. With `dry` set it takes it on a copy and leaves the state alone, which is
  how the tab asks whether a step is allowed. It answers the labels of the outputs, or `{"ok":false,"refused":true,"why":"…"}` when the model's guards say no.
  `refused` is false when the step failed for another reason, such as a label that does not parse.
- `naima_state()` answers the state as JSON.
- `naima_candidates()` answers the inputs worth trying now. The tab dry-runs each one, and the ones that pass are the steps it offers.
- `naima_save()`, `naima_load(h)` and `naima_drop(h)` keep a copy of the state under a handle, make it current again, and let it go. They let the tab move along
  a path at once instead of replaying it.

Labels are written as mCRL2 writes the actions of the composed system, `ask(c1)` and `grant(c3)`, not `c_ask`. That way a trace from the model checker reads the
same as a path in the tab.

Here is `naima_step` from the example:

```rust
#[unsafe(no_mangle)]
pub extern "C" fn naima_step(ptr: *const u8, len: usize, dry: i32) -> i32 {
    let ev = match event(&argument(ptr, len)) {
        Ok(ev) => ev,
        Err(e) => return answer(not_taken(&e, false), false),
    };
    let result = STEPPER.with(|s| {
        let mut s = s.borrow_mut();
        let Some(state) = s.state.as_mut() else {
            return Err(("there is no state yet: call naima_init first".to_string(), false));
        };
        let mut outputs = Vec::new();
        let taken = if dry != 0 {
            let mut copy = state.clone();
            copy.step(&ev, &mut outputs)
        } else {
            state.step(&ev, &mut outputs)
        };
        match taken {
            Ok(()) => Ok(outputs),
            Err(e) => Err(why(&e)),
        }
    });
    match result {
        Ok(outputs) => answer(stepped(&outputs), true),
        Err((reason, refused)) => answer(not_taken(&reason, refused), false),
    }
}
```

The state is one JSON object with one member per parameter of `Core`. A value is written according to its sort. A `Bool` is `true` or `false`, a number is a
number, a list is an array, and a value of a structured sort is a string, written as mCRL2 prints it (`"c1"`, `"HOLDING"`). A function such as
`phase: Client -> Phase` is its default and the keys whose value differs from it. After `ask(c1)`, `ask(c3)` and `ask(c2)` the lock's state is

```json
{ "phase": { "default": "IDLE", "at": { "c1": "HOLDING", "c2": "WAITING", "c3": "WAITING" } }, "queue": ["c3", "c2"], "free": false }
```

Candidates matter when inputs carry data from a sort with no bound, since the tab cannot try every value. The stepper then proposes the values the guards could
plausibly accept, such as each id that exists now. The lock has three clients and two inputs, so it simply proposes all six labels and lets the guards decide:

```rust
#[unsafe(no_mangle)]
pub extern "C" fn naima_candidates() -> i32 {
    let mut labels = Vec::new();
    for c in ["c1", "c2", "c3"] {
        labels.push(format!("ask({c})"));
        labels.push(format!("release({c})"));
    }
    answer(json_array(&labels), true)
}
```

`stepper/Cargo.toml` depends on the generated crate by path, builds both a `cdylib` (the .wasm) and an `rlib` (for the tests), and declares a `[workspace]` of
its own so that no enclosing Cargo workspace claims it. The tests at the end of `lib.rs` run natively with `cargo test --manifest-path stepper/Cargo.toml`.

## 4. Build stepper.wasm

```sh
cargo build --manifest-path stepper/Cargo.toml --release --target wasm32-unknown-unknown --lib
cp stepper/target/wasm32-unknown-unknown/release/lock_stepper.wasm build/stepper.wasm
```

The tab instantiates the module with no imports at all, so it can compute and nothing else. A module that imports anything is refused when the study opens.
Plain Rust with the standard library and no dependency that reaches the system builds this way.

## 5. Declare the study

The declaration lives in an mCRL2 file next to the model, in comments, so that it travels with the model. The example's `study.mcrl2` holds only comments:

```
%@ui begin
% title     A lock shared by three clients
% says      Be the clients: ask for the lock and let it go, and watch who gets it and how long the others wait.
% model     model/core.mcrl2
% stepper   build/stepper.wasm
% observer  build/observer.js
% view      build/view.js
% diagrams  uml-state-machine: each client's phase, idle, waiting or holding; uml-sequence: the clients and the lock, each step a message
%@ui end
```

Each line between the markers is `% <key> <value>`, and these are the keys.

- `title` and `says` are what the tab's list of studies shows.
- `model` names the model, only to show it.
- `stepper` is the WebAssembly module of step 4. It is required.
- `observer` and `view` are the two modules of steps 6 and 7. Without them the tab still shows the state, the steps and the path.
- `config` gives the stepper's configuration, as `name=value` pairs separated by spaces, such as `w=2 r=4`. Missing ones take the stepper's defaults. The lock
  has none, so the example leaves the key out.
- `diagrams` names the standard diagrams the view draws (step 8).

Paths are relative to the declaring file and must stay inside its folder. A block with an unknown key, no `stepper`, or a path that leaves the folder is listed
with the reason and not opened. The tab finds every `.mcrl2` file of the project that git tracks and that holds a `%@ui begin` line, so add the file to git
before you look for it in the tab.

The same file explains each kind of step, one `%@say` line per kind:

```
%@say ask(c): "ask for the lock" | "{c} asks for the lock. If the lock is free and nobody waits, {c} gets it at once; otherwise it joins the end of the queue."
%@say release(c): "let the lock go" | "{c} lets the lock go. The lock is free again, and the client that has waited longest gets it."
%@say grant(c): "the lock is granted" | "The lock is free and {c} has waited longest: {c} now holds it."
```

The head is an action and its arguments. Each argument is either a variable, which takes the step's value at that position, or a value the step must carry, such
as `c1` or `true`. A line with no parentheses matches the action whatever its arguments. The phrase before `|` is a few words for lists and the timeline, and
the explanation after it is shown with the step. `{c}` is replaced by the value bound to `c`, as mCRL2 writes it.

A step takes the first line, in file order, whose head matches it. To say something special about one client, put its line before the general one:

```
%@say ask(c1): "the first client asks" | "c1 asks for the lock."
%@say ask(c): "ask for the lock" | "{c} asks for the lock."
```

## 6. Write the observer

The observer is what the view remembers about the path: things the model's state does not hold, such as how long each client has waited. It is a module with two
functions. `init` makes the memory from the configuration and the initial state, and `on` takes the memory and one entry of the path and returns the next
memory. An entry is the input, the outputs it caused, the state before and after, and whether it was recorded from a real run.

`on` must be pure. It reads only its arguments, returns a new memory, and keeps nothing between calls. Because of that, the memory at any point of the path is
the same however it is computed, so the tab can keep copies along the path and fold from the nearest one when you move back and forth. The memory must be plain
data, the kind `structuredClone` copies.

From `view/src/observer.svelte.ts`:

```ts
export function on(m: Memory, e: Entry): Memory {
  const n: Memory = structuredClone(m);
  n.steps++;
  const who = String(e.input.args[0]);
  if (e.input.action === "ask") n.askedAt[who] = n.steps;
  n.messages.push({ from: who, to: LOCK, label: e.input.phrase ?? e.input.action, title: e.input.label });
  for (const o of e.outputs) {
    const to = String(o.args[0]);
    if (o.action === "grant" && to in n.askedAt) {
      n.waits[to] = [...(n.waits[to] ?? []), n.steps - n.askedAt[to]!];
      delete n.askedAt[to];
    }
    n.messages.push({ from: LOCK, to, label: o.phrase ?? o.action, title: o.label });
  }
  n.messages = n.messages.slice(-MESSAGES);
  n.holder = holderOf(e.after);
  n.queue = [...e.after.queue];
  return n;
}
```

The lock counts time in steps, one entry of the path being one step. A model with time of its own has an environment action such as `tick`, and its observer
counts those instead.

## 7. Write the view

The view is a Svelte component, `View.svelte`, mounted by `view.ts`, which exports `mount(target, host)` and returns `{ destroy }`. It runs in a sandboxed frame
and sees only what the host gives it.

- `host.data` is the latest data, or null before the first. It holds `state`, `allowed` (the inputs allowed now, each with its label, action, arguments,
  explanation and the outputs it would cause), `memory` (the observer's), `current` (whether that memory is for the place you stand), `last` (the entry that led
  here), and `position`, `length` and `real`.
- `host.subscribe(fn)` calls `fn` with each new data. Keep it in the component's own `$state`.
- `host.fire(label)` takes a step. The tab checks it like any other, so a step the guards refuse changes nothing and the answer says why.
- `host.can(label)` dry-runs any input without taking it.
- `host.say(label)` gives the `%@say` phrase and explanation of any label.

The view never sees the path or the stepper. Anything it must remember across a move of the cursor belongs in the observer's memory; a hover or a selection is
its own.

From the example's `View.svelte`, the data and the buttons:

```svelte
let data: Data<Memory> | null = $state(null);
onMount(() => {
  data = host.data as Data<Memory> | null;
  return host.subscribe((d) => (data = d as Data<Memory>));
});

let refusal: string | null = $state(null);
const allowed = (label: string) => (data?.allowed ?? []).some((a) => a.label === label);

async function fire(label: string) {
  const r = await host.fire(label);
  refusal = r.ok ? null : (r.why ?? "not allowed now");
}
```

```svelte
<button disabled={!allowed(`ask(${c})`)} title={host.say(`ask(${c})`)?.text} onclick={() => fire(`ask(${c})`)}>ask</button>
```

The frame receives Naima's design tokens as CSS custom properties, such as `--color-accent`, `--color-text`, `--color-text-muted`, `--color-border-strong`,
`--color-danger` and `--font-family-body`. They follow the light and dark themes, so a view styled with them looks like the rest of Naima.

The widgets the tab itself is drawn with form a library your view can import as `@naima/study/…`: `Bento.svelte` (cards on a grid), `Graph.svelte` (a graph laid
out by itself), `Timeline.svelte` and `Sequence.svelte` (a UML sequence diagram). They are in Naima at `src/plugins/verifier-mcrl2/widgets/study/`. The build
finds them through an alias in `view/vite.config.ts`. The example lives inside Naima, so its alias points four folders up; in your project, point it at the
Naima you use.

```ts
const widgets = fileURLToPath(new URL("../../../../src/plugins/verifier-mcrl2/widgets/study", import.meta.url));

export default defineConfig({
  root: import.meta.dirname,
  // The styles travel inside view.js, since the tab loads one module per frame.
  plugins: [svelte({ compilerOptions: { css: "injected" } })],
  resolve: {
    alias: { "@naima/study": widgets },
    // The widgets live outside this folder: they use this folder's copy of each package.
    dedupe: ["svelte", "@lucide/svelte"],
  },
```

The same file builds `src/view.ts` and `src/observer.svelte.ts` as two ES modules into `../build/`, with what they share in `shared.js`.

## 8. Name the diagrams you draw

When a view draws something a reader already knows as a standard diagram, call it by its name and draw that notation as the standard defines it. A UML state
machine has rounded states, a filled dot for the initial state and open arrowheads; a sequence diagram has one lifeline per participant and messages from top to
bottom. Change nothing of the notation, so that anyone who knows UML or BPMN reads your view without a legend. A picture that is no standard is a directed
graph, and naming it so keeps it from being mistaken for one.

The lock's view draws two. Each client is a UML state machine, idle, waiting and holding, with the state it is in now highlighted:

```svelte
<Graph label="the state machine of client {c}" notation="uml-state-machine" autofit nodes={machine(c)} edges={EDGES} />
```

The conversation is a UML sequence diagram, one lifeline per client and one for the lock, each step a message:

```svelte
<Sequence label="the clients and the lock, each step a message" {lifelines} messages={memory?.messages ?? []} />
```

Declare what you draw in the `%@ui` block, each name followed by what it maps, separated by semicolons, as the `diagrams` line in step 5 does. The names Naima
knows are `uml-state-machine`, `uml-sequence`, `uml-communication`, `uml-activity`, `uml-timing`, `bpmn-process` and `directed-graph`.

## 9. Build it and open it

`build.sh` (or `build.cmd` on Windows) runs every step above from the model. It finds naima-codegen as `NAIMA_CODEGEN`, or as `naima-codegen` on your `PATH`.

```sh
sh build.sh
```

It writes `build/stepper.wasm`, `build/view.js`, `build/observer.js` and `build/shared.js`. The first view build downloads the npm packages the view uses into
`view/node_modules/`.

Then run `naima ui`, choose Models from Home's list, and pick the study. Ask for the lock as `c1`, then as `c3` and `c2`, then let `c1` release it: `c3` gets
it, because it asked first.

## 10. Check it

When the study opens, the tab reads the stepper's description and checks the declaration against it. Each `%@say` line must name an action among the inputs,
outputs or environment actions, with the right number of arguments; every `{var}` must be a variable of its head, and every value must parse. Each name under
`diagrams` must be a name Naima knows. A line that fails is listed with the study's problems, with the reason, and is not used; the rest of the study still
opens. Read that list after every change to the model or to `study.mcrl2`.

The stepper has its own tests:

```sh
cargo test --manifest-path stepper/Cargo.toml
```

And to see that the module imports nothing, load it in Node and print `WebAssembly.Module.imports` of it; for the example it is an empty list.
