// The shell: one window showing the built page, the platform bridge's commands, which it forwards to the Naima
// sidecar it starts (bridge.rs), and the naima-files: scheme for a tab's pages (files.rs). The mobile targets enter
// here directly; the desktop ones through main.rs.
//
// When STANCE_UI_E2E holds a script (the stance's `platforms` check sets it), the shell evaluates it in the
// page once the page has loaded and prints its report as one line, "e2e: {...}". The app stays open, so that
// the check can take its screenshot with the result on screen, and then ends it. Without the variable
// nothing of this runs.
mod bridge;
mod files;
mod menu;

use bridge::{Current, Sidecar};
use tauri::webview::PageLoadEvent;
use tauri::{Manager, RunEvent};

#[tauri::command]
fn e2e_report(report: serde_json::Value) {
    println!("e2e: {report}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The script is an expression: a final semicolon, as a formatter leaves it, would end it too early.
    let e2e = std::env::var("STANCE_UI_E2E")
        .ok()
        .map(|s| s.trim().trim_end_matches(';').to_string())
        .filter(|s| !s.is_empty());
    let app = tauri::Builder::default()
        .setup(|app| {
            let sidecar = Sidecar::start(app.handle().clone())?;
            app.manage(Current::new(sidecar));
            app.manage(menu::Zoom::default());
            #[cfg(target_os = "macos")]
            {
                let bar = menu::build(app.handle())?;
                app.set_menu(bar)?;
                app.on_menu_event(menu::on_event);
            }
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("naima-files", |ctx, request, responder| {
            let sidecar = ctx.app_handle().state::<Current>().get();
            files::serve(sidecar, request, responder);
        })
        .invoke_handler(tauri::generate_handler![
            bridge::describe,
            bridge::data,
            bridge::tabs,
            bridge::tab,
            bridge::metro,
            bridge::action,
            bridge::run,
            bridge::recent,
            bridge::switch,
            e2e_report,
            menu::zoom_by,
            menu::timeline_placed
        ])
        .on_page_load(move |webview, payload| {
            if let PageLoadEvent::Finished = payload.event() {
                let _ = webview.eval(menu::WHEEL);
                menu::allow_pinch(webview);
            }
            if let (Some(script), PageLoadEvent::Finished) = (&e2e, payload.event()) {
                println!("e2e: page loaded, running the script");
                let run = format!(
                    "Promise.resolve().then(() => ({script})).then((r) => r, (e) => ({{ ok: false, says: String(e) }}))\
                     .then((report) => window.__TAURI_INTERNALS__.invoke('e2e_report', {{ report }}))"
                );
                if let Err(e) = webview.eval(&run) {
                    println!("e2e: {}", serde_json::json!({ "ok": false, "says": format!("cannot evaluate the script: {e}") }));
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("the app could not start");
    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            handle.state::<Current>().get().stop();
        }
    });
}
