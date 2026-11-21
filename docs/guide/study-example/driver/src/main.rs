//! The lock's program: three clients ask for the lock and let it go, in a fixed order,
//! and the generated lock answers. Every step is printed as the Models tab writes it, with
//! who holds the lock after it. The program counts the holders itself, from the grants
//! and the releases, and stops with an error if two clients ever hold the lock at once:
//! the run of the code that a counterexample of mutual exclusion predicts.

use lock::{Action, Client, Config, Event, State};
use std::collections::BTreeSet;
use std::process::ExitCode;

fn name(c: &Client) -> &'static str {
    match c {
        Client::c1 => "c1",
        Client::c2 => "c2",
        Client::c3 => "c3",
    }
}

fn main() -> ExitCode {
    let mut holders: BTreeSet<&'static str> = BTreeSet::new();
    let mut out = Vec::new();
    let mut state = match State::new(Config {}, &mut out) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("the lock did not start: {e:?}");
            return ExitCode::FAILURE;
        }
    };
    // Every client asks; then each, once it holds the lock, lets it go.
    let script = [
        Event::Ask(Client::c1),
        Event::Ask(Client::c2),
        Event::Ask(Client::c3),
        Event::Release(Client::c1),
        Event::Release(Client::c2),
        Event::Release(Client::c3),
    ];
    for event in script.iter() {
        let said = match event {
            Event::Ask(c) => format!("ask({})", name(c)),
            Event::Release(c) => {
                holders.remove(name(c));
                format!("release({})", name(c))
            }
        };
        out.clear();
        if let Err(e) = state.step(event, &mut out) {
            eprintln!("{said}: refused by the lock ({e:?})");
            return ExitCode::FAILURE;
        }
        println!("{said}");
        for action in out.iter() {
            let Action::Grant(c) = action;
            holders.insert(name(c));
            println!("  grant({})", name(c));
        }
        let now: Vec<_> = holders.iter().copied().collect();
        println!("  holding the lock: {}", if now.is_empty() { "nobody".to_string() } else { now.join(", ") });
        if holders.len() > 1 {
            eprintln!("mutual exclusion is broken: {} hold the lock at once", now.join(" and "));
            return ExitCode::FAILURE;
        }
    }
    println!("the run ended: every client had the lock in turn, and never two at once");
    ExitCode::SUCCESS
}
