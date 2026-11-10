// The platform bridge's commands on Tauri: each forwards to Naima, the sidecar the shell starts in the project's
// folder (`naima ui --sidecar`), which answers Naima's bridge commands over its standard input and output, one JSON
// object a line: the same commands the browser reaches over HTTP, with no network listener. What the sidecar pushes on
// a feed is emitted as the Tauri event of the same name, which the page's tauriBridge() listens to. A file of a tab's
// folder, for a page or a frame, is served by the naima-files: scheme (files.rs), read through the sidecar too.
// Switching to another recent project (the page's `switch`) is the shell's own: it asks the sidecar for the recent
// projects (`recent`), and when the one chosen is among them it stops the sidecar and starts one there; the page then
// reloads, and every screen reopens on that project.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::bundle::Dir;

/// How long a command may take before the page is told it failed: an action runs as a run of `naima run`.
const TIMEOUT: Duration = Duration::from_secs(300);

type Answer = Result<Value, String>;

/// The Naima process the shell talks to, and the answers it waits for, by request.
pub struct Sidecar {
    stdin: Mutex<ChildStdin>,
    next: AtomicU64,
    waiting: Arc<Mutex<HashMap<u64, mpsc::Sender<Answer>>>>,
    child: Mutex<Child>,
}

/// The project the app shows: the folder its first argument names (`open -a Naima --args <project>`), else
/// NAIMA_PROJECT, else the first folder up from the current one that holds Naima's tracker.
fn project() -> Result<PathBuf, String> {
    if let Some(p) = std::env::args().nth(1).filter(|a| !a.starts_with('-')).map(PathBuf::from).filter(|p| p.is_dir()) {
        return Ok(p);
    }
    if let Ok(p) = std::env::var("NAIMA_PROJECT") {
        return Ok(PathBuf::from(p));
    }
    let here = std::env::current_dir().map_err(|e| e.to_string())?;
    here.ancestors()
        .find(|d| d.join("naima-tracker").join("naima.sh").is_file())
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("no Naima project in {} or a folder above it: set NAIMA_PROJECT", here.display()))
}

/// Has the page come from the bundle of the project's program, which the sidecar names: the one the app was built with
/// when it names none (a program older than the shell) or the folder holds no page.
pub fn show_bundle(sidecar: &Sidecar, dir: &Dir) {
    let named = sidecar.call("bundle", json!({})).ok().and_then(|a| a.get("dir").and_then(Value::as_str).map(PathBuf::from));
    dir.set(named.clone());
    // Said once per project, as the commands are: which bundle the window shows.
    println!("bundle: {}", if dir.in_use() { named.map(|d| d.display().to_string()).unwrap_or_default() } else { "the one the app was built with".into() });
}

/// Brings the app's window to the front, out of the Dock if it was minimised.
fn raise(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The sidecar the shell talks to now: replaced when the person switches to another recent project.
pub struct Current(Mutex<Arc<Sidecar>>);

impl Current {
    pub fn new(sidecar: Arc<Sidecar>) -> Current {
        Current(Mutex::new(sidecar))
    }

    pub fn get(&self) -> Arc<Sidecar> {
        Arc::clone(&self.0.lock().unwrap())
    }

    fn replace(&self, sidecar: Arc<Sidecar>) -> Arc<Sidecar> {
        std::mem::replace(&mut *self.0.lock().unwrap(), sidecar)
    }
}

impl Sidecar {
    /// Starts Naima in the project the app shows at its start.
    pub fn start(app: AppHandle) -> Result<Arc<Sidecar>, String> {
        Sidecar::start_in(app, project()?)
    }

    /// Starts Naima in the project's folder and reads what it says: answers to their request, feeds as events.
    pub fn start_in(app: AppHandle, root: PathBuf) -> Result<Arc<Sidecar>, String> {
        let mut command = if cfg!(windows) {
            let mut c = Command::new(root.join("naima-tracker").join("naima.cmd"));
            c.args(["ui", "--sidecar"]);
            c
        } else {
            let mut c = Command::new("sh");
            c.arg(root.join("naima-tracker").join("naima.sh")).args(["ui", "--sidecar"]);
            c
        };
        let mut child = command
            .current_dir(&root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("cannot start Naima in {}: {e}", root.display()))?;
        let stdin = child.stdin.take().ok_or("no input to Naima")?;
        let stdout = child.stdout.take().ok_or("no output from Naima")?;
        let waiting: Arc<Mutex<HashMap<u64, mpsc::Sender<Answer>>>> = Arc::default();
        let readers = waiting.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                // Naima's launcher may say a line of its own: only JSON objects are the bridge's.
                let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
                if let Some(feed) = message.get("feed").and_then(Value::as_str) {
                    let event = message.get("event").cloned().unwrap_or(Value::Null);
                    // `naima ui` run again on the project the app shows asks for its window, which is the shell's alone.
                    if feed == "show" && event.get("kind").and_then(Value::as_str) == Some("raise") {
                        raise(&app);
                        continue;
                    }
                    let _ = app.emit(feed, event);
                } else if let Some(id) = message.get("id").and_then(Value::as_u64) {
                    if let Some(to) = readers.lock().unwrap().remove(&id) {
                        let answer = match message.get("error").and_then(Value::as_str) {
                            Some(e) => Err(e.to_string()),
                            None => Ok(message.get("ok").cloned().unwrap_or(Value::Null)),
                        };
                        let _ = to.send(answer);
                    }
                }
            }
            // Naima ended: every command still waiting fails rather than hanging.
            for (_, to) in readers.lock().unwrap().drain() {
                let _ = to.send(Err("Naima stopped".into()));
            }
        });
        Ok(Arc::new(Sidecar { stdin: Mutex::new(stdin), next: AtomicU64::new(1), waiting, child: Mutex::new(child) }))
    }

    /// Runs one bridge command in Naima and waits for its answer. It follows the shell's side of the sidecar
    /// protocol's model (develop/models/ui/sidecar/model/env.mcrl2): the caller waits before it writes, so an answer
    /// that comes at once finds it, and a caller that gives up waits no more, so its late answer is dropped.
    pub fn call(&self, command: &str, args: Value) -> Answer {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (to, from) = mpsc::channel();
        self.waiting.lock().unwrap().insert(id, to);
        let line = json!({ "id": id, "command": command, "args": args }).to_string();
        if let Err(e) = writeln!(self.stdin.lock().unwrap(), "{line}") {
            self.waiting.lock().unwrap().remove(&id);
            return Err(format!("cannot reach Naima: {e}"));
        }
        from.recv_timeout(TIMEOUT).unwrap_or_else(|_| {
            self.waiting.lock().unwrap().remove(&id);
            Err(format!("{command}: no answer from Naima"))
        })
    }

    /// Stops Naima, as the app quits.
    pub fn stop(&self) {
        let _ = self.child.lock().unwrap().kill();
    }
}

/// Forwards the command the page invoked, its arguments as they came, and says so once per call, which is how the
/// stance's platforms check sees the app ready.
async fn forward(current: State<'_, Current>, command: &'static str, request: Request<'_>) -> Answer {
    let args = match request.body() {
        InvokeBody::Json(v) if v.is_object() => v.clone(),
        _ => json!({}),
    };
    let sidecar = current.get();
    let answer = tauri::async_runtime::spawn_blocking(move || sidecar.call(command, args))
        .await
        .map_err(|e| e.to_string())?;
    println!("bridge: {command} -> {}", if answer.is_ok() { "ok" } else { "error" });
    answer
}

macro_rules! commands {
    ($($name:ident),*) => {$(
        #[tauri::command]
        pub async fn $name(current: State<'_, Current>, request: Request<'_>) -> Answer {
            forward(current, stringify!($name), request).await
        }
    )*};
}

// Naima's bridge commands (naima/src/plugins/ui/bridge.ts), each listed in lib.rs's generate_handler!.
commands!(describe, data, tabs, tab, metro, action, run, recent);

/// The root of the recent project `root` names, when the sidecar lists it among the recent projects and it is not
/// the one shown now; why not otherwise.
pub fn chosen(recent: &Value, root: &str) -> Result<PathBuf, String> {
    let projects = recent.get("projects").and_then(Value::as_array).ok_or("no list of recent projects")?;
    let found = projects
        .iter()
        .find(|p| p.get("root").and_then(Value::as_str) == Some(root))
        .ok_or_else(|| format!("{root} is not one of the recent projects"))?;
    if found.get("here").and_then(Value::as_bool) == Some(true) {
        return Err("that is the project shown now".into());
    }
    Ok(PathBuf::from(root))
}

/// The page's `switch`: Naima is restarted in the recent project chosen, and answers there from then on.
#[tauri::command]
pub async fn switch(app: AppHandle, current: State<'_, Current>, dir: State<'_, Dir>, request: Request<'_>) -> Answer {
    let root = match request.body() {
        InvokeBody::Json(v) => v.get("root").and_then(Value::as_str).map(str::to_string),
        _ => None,
    }
    .ok_or("switch names the project's root")?;
    let sidecar = current.get();
    let recent = tauri::async_runtime::spawn_blocking(move || sidecar.call("recent", json!({})))
        .await
        .map_err(|e| e.to_string())??;
    let at = chosen(&recent, &root)?;
    let next = Sidecar::start_in(app, at.clone())?;
    let shown = Arc::clone(&next);
    let page = dir.inner().clone();
    tauri::async_runtime::spawn_blocking(move || show_bundle(&shown, &page)).await.map_err(|e| e.to_string())?;
    current.replace(next).stop();
    println!("bridge: switch -> ok");
    Ok(json!({ "root": root, "path": at.display().to_string() }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn switches_only_to_another_recent_project() {
        let recent = json!({ "projects": [{ "name": "a", "root": "/a", "here": true }, { "name": "b", "root": "/b", "here": false }] });
        assert_eq!(chosen(&recent, "/b"), Ok(PathBuf::from("/b")));
        assert!(chosen(&recent, "/a").is_err());
        assert!(chosen(&recent, "/c").is_err());
        assert!(chosen(&json!({}), "/b").is_err());
    }
}
