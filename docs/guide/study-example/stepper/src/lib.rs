//! The lock behind the stepper interface of Naima's Models tab, version 1.
//!
//! The lock itself is the crate `lock`, which naima-codegen generates from
//! ../model/core.mcrl2. This file decides nothing: it only translates. Labels come
//! in as mCRL2 writes the actions of the composed system (`ask(c1)`, `release(c2)`),
//! labels go out the same way (`grant(c1)`), and the state goes out as JSON.
//!
//! Every exported function that answers writes a UTF-8 JSON text into one output
//! buffer, which the host reads with `naima_out_ptr` and `naima_out_len`, and returns
//! 1 when it succeeded and 0 when it did not.
//!
//! Built for wasm32-unknown-unknown, the module imports nothing (see ../build.sh).

use lock::{Action, Client, Config, Event, M2, Phase, State, StepError};
use std::cell::RefCell;
use std::collections::BTreeMap;

// -------------------------------------------------------------------------------------
// What the module keeps between calls.

struct Stepper {
    /// The last answer, which the host reads with naima_out_ptr and naima_out_len.
    out: String,
    /// The lock's current state, once naima_init has made it.
    state: Option<State>,
    /// Copies of the state kept by naima_save, by handle.
    saved: BTreeMap<i32, State>,
    /// The next handle naima_save gives out (0 means "no copy", so it starts at 1).
    next: i32,
}

thread_local! {
    static STEPPER: RefCell<Stepper> = RefCell::new(Stepper {
        out: String::new(),
        state: None,
        saved: BTreeMap::new(),
        next: 1,
    });
}

/// Keeps `text` as the answer and returns 1 when `ok`, 0 otherwise.
fn answer(text: String, ok: bool) -> i32 {
    STEPPER.with(|s| s.borrow_mut().out = text);
    if ok { 1 } else { 0 }
}

/// The argument the host wrote at `ptr`, `len` bytes long, as text.
fn argument(ptr: *const u8, len: usize) -> String {
    if ptr.is_null() || len == 0 {
        return String::new();
    }
    // SAFETY: the host wrote `len` bytes at `ptr`, into a buffer it got from naima_alloc.
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    String::from_utf8_lossy(bytes).into_owned()
}

// -------------------------------------------------------------------------------------
// The interface version and the buffers.

/// The version of the stepper interface this module implements.
#[unsafe(no_mangle)]
pub extern "C" fn naima_abi() -> i32 {
    1
}

/// A buffer of `len` bytes, for the host to write an argument into.
#[unsafe(no_mangle)]
pub extern "C" fn naima_alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len.max(1));
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer); // the host owns it until naima_free
    ptr
}

/// Gives back a buffer made by naima_alloc.
///
/// # Safety
/// `ptr` and `len` must be exactly what naima_alloc gave and was asked for.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn naima_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        // SAFETY: ptr came from naima_alloc(len), which made a Vec of that capacity.
        drop(unsafe { Vec::from_raw_parts(ptr, 0, len.max(1)) });
    }
}

/// Where the last answer starts in the module's memory.
#[unsafe(no_mangle)]
pub extern "C" fn naima_out_ptr() -> *const u8 {
    STEPPER.with(|s| s.borrow().out.as_ptr())
}

/// How many bytes the last answer has.
#[unsafe(no_mangle)]
pub extern "C" fn naima_out_len() -> usize {
    STEPPER.with(|s| s.borrow().out.len())
}

// -------------------------------------------------------------------------------------
// The description: the actions and the state, as the model declares them.

/// The lock has no configuration and no environment action of its own (such as time).
/// `state` lists the parameters of `proc Core`, in order, with their sorts.
const DESCRIPTION: &str = r#"{
  "abi": 1,
  "model": "a lock shared by three clients",
  "config": [],
  "inputs": [
    { "action": "ask", "args": ["Client"] },
    { "action": "release", "args": ["Client"] }
  ],
  "outputs": [
    { "action": "grant", "args": ["Client"] }
  ],
  "environment": [],
  "state": [
    { "name": "phase", "sort": "Client -> Phase" },
    { "name": "queue", "sort": "List(Client)" },
    { "name": "free", "sort": "Bool" }
  ]
}"#;

#[unsafe(no_mangle)]
pub extern "C" fn naima_describe() -> i32 {
    answer(DESCRIPTION.to_string(), true)
}

// -------------------------------------------------------------------------------------
// Labels: from text to the generated code's events, and back.

/// A value as mCRL2 prints it, using the generated code's printer.
fn mcrl2<X: M2>(x: &X) -> String {
    let mut text = String::new();
    x.m2(&mut text);
    text
}

/// A client from its name as mCRL2 prints it.
fn client(name: &str) -> Result<Client, String> {
    match name.trim() {
        "c1" => Ok(Client::c1),
        "c2" => Ok(Client::c2),
        "c3" => Ok(Client::c3),
        other => Err(format!("{other} is not a client: the clients are c1, c2 and c3")),
    }
}

/// An input's label, such as `ask(c1)`, as an event of the generated code.
/// Every action of the lock has one argument, a client, so the label is
/// `<action>(<client>)`.
fn event(label: &str) -> Result<Event, String> {
    let label = label.trim();
    let (action, rest) = label.split_once('(').ok_or(format!("{label} has no argument"))?;
    let argument = rest.strip_suffix(')').ok_or(format!("{label} lacks its closing parenthesis"))?;
    let c = client(argument)?;
    match action.trim() {
        "ask" => Ok(Event::Ask(c)),
        "release" => Ok(Event::Release(c)),
        "grant" => Err("grant is the lock's own step: the environment cannot take it".to_string()),
        other => Err(format!("the lock has no input {other}")),
    }
}

/// An output of the generated code as its label, such as `grant(c1)`.
fn label(action: &Action) -> String {
    match action {
        Action::Grant(c) => format!("grant({})", mcrl2(c)),
    }
}

// -------------------------------------------------------------------------------------
// JSON.

/// A string as a JSON string, with the characters JSON needs escaped.
fn json_string(text: &str) -> String {
    let mut out = String::from("\"");
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// A list of strings as a JSON array.
fn json_array(items: &[String]) -> String {
    let quoted: Vec<String> = items.iter().map(|i| json_string(i)).collect();
    format!("[{}]", quoted.join(","))
}

/// A step that was taken: the labels of the outputs it caused, in order.
fn stepped(outputs: &[Action]) -> String {
    let labels: Vec<String> = outputs.iter().map(label).collect();
    format!("{{\"ok\":true,\"outputs\":{}}}", json_array(&labels))
}

/// A step that was not taken. `refused` is true when the model's guards said no,
/// false when the step failed for another reason (a bad label, an undefined value).
fn not_taken(why: &str, refused: bool) -> String {
    format!("{{\"ok\":false,\"refused\":{refused},\"why\":{}}}", json_string(why))
}

/// The state as JSON: one member per parameter of Core.
///
/// - `phase`, a function `Client -> Phase`, is `{ "default": v, "at": { key: v } }`,
///   with only the clients whose phase is not the default;
/// - `queue`, a `List(Client)`, is an array of the clients as mCRL2 prints them;
/// - `free`, a `Bool`, is `true` or `false`.
fn state_json(state: &State) -> String {
    let s = state.state();
    let at: Vec<String> = s
        .phase
        .entries()
        .into_iter()
        .map(|(c, p): (Client, &Phase)| format!("{}:{}", json_string(&mcrl2(&c)), json_string(&mcrl2(p))))
        .collect();
    let phase = format!(
        "{{\"default\":{},\"at\":{{{}}}}}",
        json_string(&mcrl2(s.phase.default_value())),
        at.join(",")
    );
    let queue: Vec<String> = s.queue.iter().map(mcrl2).collect();
    format!("{{\"phase\":{phase},\"queue\":{},\"free\":{}}}", json_array(&queue), s.free)
}

/// Why the generated code did not take a step, and whether its guards refused it.
fn why(error: &StepError) -> (String, bool) {
    match error {
        StepError::Refused(_) => ("the lock's guards do not accept this input now".to_string(), true),
        StepError::Overflow(what) => (format!("a value overflows: {what}"), false),
        StepError::Undefined(what) => (format!("a value is undefined: {what}"), false),
        StepError::StepLimit => ("the lock took too many steps of its own".to_string(), false),
        StepError::NotQuiescent => ("the lock had steps of its own still to take".to_string(), false),
    }
}

// -------------------------------------------------------------------------------------
// Making the state and stepping.

/// Makes the initial state. The argument is the configuration as a JSON object; the
/// lock has none, so it is not read. Answers the outputs the lock took at once.
#[unsafe(no_mangle)]
pub extern "C" fn naima_init(_ptr: *const u8, _len: usize) -> i32 {
    let mut outputs = Vec::new();
    match State::new(Config {}, &mut outputs) {
        Ok(state) => {
            STEPPER.with(|s| {
                let mut s = s.borrow_mut();
                s.state = Some(state);
                s.saved.clear();
            });
            answer(stepped(&outputs), true)
        }
        Err(e) => answer(not_taken(&why(&e).0, false), false),
    }
}

/// Takes the input whose label is at `ptr`. With `dry` set, it takes it on a copy of
/// the state and leaves the state as it was: that is how the tab asks whether a step
/// is allowed. Answers the outputs the lock took in reply, or why it was not taken.
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

/// The current state as JSON.
#[unsafe(no_mangle)]
pub extern "C" fn naima_state() -> i32 {
    let json = STEPPER.with(|s| s.borrow().state.as_ref().map(state_json));
    match json {
        Some(json) => answer(json, true),
        None => answer("null".to_string(), false),
    }
}

/// The inputs worth trying now. The lock has three clients and two inputs, so every
/// one of the six is a candidate: the tab dry-runs each, and the lock's guards decide
/// which are allowed.
#[unsafe(no_mangle)]
pub extern "C" fn naima_candidates() -> i32 {
    let mut labels = Vec::new();
    for c in ["c1", "c2", "c3"] {
        labels.push(format!("ask({c})"));
        labels.push(format!("release({c})"));
    }
    answer(json_array(&labels), true)
}

// -------------------------------------------------------------------------------------
// Copies of the state, so that the tab moves back and forth along a path at once.

/// Keeps a copy of the current state and returns its handle (0 when there is none).
#[unsafe(no_mangle)]
pub extern "C" fn naima_save() -> i32 {
    STEPPER.with(|s| {
        let mut s = s.borrow_mut();
        let Some(copy) = s.state.clone() else { return 0 };
        let handle = s.next;
        s.next = if s.next == i32::MAX { 1 } else { s.next + 1 };
        s.saved.insert(handle, copy);
        handle
    })
}

/// Makes the copy kept under `handle` the current state again (1), or 0 if there is none.
#[unsafe(no_mangle)]
pub extern "C" fn naima_load(handle: i32) -> i32 {
    STEPPER.with(|s| {
        let mut s = s.borrow_mut();
        match s.saved.get(&handle).cloned() {
            Some(copy) => {
                s.state = Some(copy);
                1
            }
            None => 0,
        }
    })
}

/// Lets go of the copy kept under `handle`.
#[unsafe(no_mangle)]
pub extern "C" fn naima_drop(handle: i32) -> i32 {
    STEPPER.with(|s| if s.borrow_mut().saved.remove(&handle).is_some() { 1 } else { 0 })
}

// -------------------------------------------------------------------------------------
// Tests, run natively with `cargo test`.

#[cfg(test)]
mod tests {
    use super::*;

    /// Calls an export and returns what it returned and the answer it left.
    fn call(f: impl FnOnce() -> i32) -> (i32, String) {
        let r = f();
        (r, STEPPER.with(|s| s.borrow().out.clone()))
    }

    fn step(label: &str, dry: bool) -> (i32, String) {
        call(|| naima_step(label.as_ptr(), label.len(), if dry { 1 } else { 0 }))
    }

    fn init() {
        assert_eq!(call(|| naima_init(std::ptr::null(), 0)).0, 1);
    }

    #[test]
    fn the_first_to_ask_gets_the_lock_and_the_others_wait_in_order() {
        init();
        assert_eq!(call(|| naima_state()).1, r#"{"phase":{"default":"IDLE","at":{}},"queue":[],"free":true}"#);
        assert_eq!(step("ask(c1)", false).1, r#"{"ok":true,"outputs":["grant(c1)"]}"#);
        assert_eq!(step("ask(c3)", false).1, r#"{"ok":true,"outputs":[]}"#);
        assert_eq!(step("ask(c2)", false).1, r#"{"ok":true,"outputs":[]}"#);
        assert_eq!(
            call(|| naima_state()).1,
            r#"{"phase":{"default":"IDLE","at":{"c1":"HOLDING","c2":"WAITING","c3":"WAITING"}},"queue":["c3","c2"],"free":false}"#
        );
        // c3 asked before c2, so it is granted first.
        assert_eq!(step("release(c1)", false).1, r#"{"ok":true,"outputs":["grant(c3)"]}"#);
    }

    #[test]
    fn a_dry_run_leaves_the_state_as_it_was() {
        init();
        let before = call(|| naima_state()).1;
        assert_eq!(step("ask(c1)", true).0, 1);
        assert_eq!(call(|| naima_state()).1, before);
    }

    #[test]
    fn steps_the_guards_refuse_say_so() {
        init();
        let (ok, out) = step("release(c2)", true);
        assert_eq!(ok, 0);
        assert!(out.contains(r#""refused":true"#), "{out}");
        let (ok, out) = step("ask(c9)", true);
        assert_eq!(ok, 0);
        assert!(out.contains(r#""refused":false"#), "{out}");
    }

    #[test]
    fn a_saved_state_comes_back() {
        init();
        let handle = naima_save();
        assert_eq!(step("ask(c2)", false).0, 1);
        assert_eq!(naima_load(handle), 1);
        assert!(call(|| naima_state()).1.contains(r#""free":true"#));
        assert_eq!(naima_drop(handle), 1);
        assert_eq!(naima_load(handle), 0);
    }
}
