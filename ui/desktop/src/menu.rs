// The menu bar on macOS, the way any Mac app has one: the app's menu, Edit (so that copy and paste keep their
// shortcuts), View with the page's zoom, Go with Back, Forward and one entry per screen of the navigation, and Window.
// Going somewhere writes the page's address (#home, #diary, ...): the page follows a changed address through its own
// transitions, and Back and Forward walk the history it keeps, as the browser's buttons would. View also places the
// timeline at the top or the bottom of the window, the page's own setting (More and the timeline's bar set it too):
// an entry tells the page through the timeline-position event, and the page names each change with timeline_placed,
// which moves the checkmark, so the menu always checks where the timeline stands.
//
// Zoom is the webview's own (set_zoom), in the steps a browser takes, from the menu, its shortcuts and Cmd or Ctrl with
// the wheel; on macOS a pinch on the trackpad magnifies the page too, and Actual Size undoes both.
use std::sync::Mutex;
use tauri::menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuEvent, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime, Webview};

/// The zoom steps, as a browser takes them.
const STEPS: [f64; 13] = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

/// The screens of the navigation, in its order: the menu entry's id, its name, the address it writes, its shortcut.
const SCREENS: [(&str, &str, &str, &str); 7] = [
    ("go-home", "Home", "#home", "CmdOrCtrl+1"),
    ("go-diary", "Diary", "#diary", "CmdOrCtrl+2"),
    ("go-bugs", "Bugs", "#bugs", "CmdOrCtrl+3"),
    ("go-features", "Features", "#features", "CmdOrCtrl+4"),
    ("go-failed-tests", "Failed tests", "#failed_tests", "CmdOrCtrl+5"),
    ("go-metrics", "Metrics", "#metrics", "CmdOrCtrl+6"),
    ("go-more", "More", "#more", "CmdOrCtrl+7"),
];

/// The timeline's places, as the View menu's entries: the entry's id, its name, the place the page's setting names.
const PLACES: [(&str, &str, &str); 2] =
    [("timeline-top", "Timeline at Top", "top"), ("timeline-bottom", "Timeline at Bottom", "bottom")];

/// Check the View menu's entry for `position` and uncheck the other; nothing when there is no menu bar.
fn check_place<R: Runtime>(app: &AppHandle<R>, position: &str) {
    let Some(view) = app.menu().and_then(|m| m.get("view")).and_then(|i| i.as_submenu().cloned()) else { return };
    for (id, _, place) in PLACES {
        if let Some(item) = view.get(id).and_then(|i| i.as_check_menuitem().cloned()) {
            let _ = item.set_checked(place == position);
        }
    }
}

/// The command the page calls with where the timeline stands, at load and at each change.
#[tauri::command]
pub fn timeline_placed<R: Runtime>(app: AppHandle<R>, position: String) {
    check_place(&app, &position);
}

/// The page's zoom, as an index into STEPS.
pub struct Zoom(Mutex<usize>);

impl Default for Zoom {
    fn default() -> Self {
        Zoom(Mutex::new(5))
    }
}

/// The step after `at` in the direction `by` (+1 in, -1 out, 0 actual size), kept within the steps.
fn step(at: usize, by: i32) -> usize {
    match by {
        0 => 5,
        b if b > 0 => (at + 1).min(STEPS.len() - 1),
        _ => at.saturating_sub(1),
    }
}

/// Zoom the page in (+1), out (-1) or back to its actual size (0).
pub fn zoom<R: Runtime>(webview: &Webview<R>, by: i32) {
    let zoom = webview.state::<Zoom>();
    let mut at = zoom.0.lock().unwrap();
    *at = step(*at, by);
    let _ = webview.set_zoom(STEPS[*at]);
    #[cfg(target_os = "macos")]
    if by == 0 {
        let _ = webview.with_webview(|w| unsafe {
            let view: &objc2::runtime::AnyObject = &*(w.inner() as *const objc2::runtime::AnyObject);
            let _: () = objc2::msg_send![view, setMagnification: 1.0f64];
        });
    }
}

/// The command the page's wheel listener calls (see WHEEL): Cmd or Ctrl with the wheel zooms in or out.
#[tauri::command]
pub fn zoom_by<R: Runtime>(webview: Webview<R>, by: i32) {
    zoom(&webview, by.signum());
}

/// Evaluated in the page once loaded: Cmd or Ctrl with the wheel (or the trackpad's scroll) zooms, a step for each
/// 100 pixels of scroll, instead of scrolling.
pub const WHEEL: &str = "(() => { if (window.__naimaZoomWheel) return; window.__naimaZoomWheel = true; let acc = 0; \
    addEventListener('wheel', (e) => { if (!(e.metaKey || e.ctrlKey)) return; e.preventDefault(); acc += e.deltaY; \
    if (Math.abs(acc) < 100) return; const by = acc < 0 ? 1 : -1; acc = 0; \
    window.__TAURI_INTERNALS__.invoke('zoom_by', { by }); }, { passive: false }); })()";

/// On macOS, let a pinch on the trackpad magnify the page.
pub fn allow_pinch<R: Runtime>(webview: &Webview<R>) {
    #[cfg(target_os = "macos")]
    let _ = webview.with_webview(|w| unsafe {
        let view: &objc2::runtime::AnyObject = &*(w.inner() as *const objc2::runtime::AnyObject);
        let _: () = objc2::msg_send![view, setAllowsMagnification: true];
    });
    #[cfg(not(target_os = "macos"))]
    let _ = webview;
}

/// The menu bar.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let name = "Naima";
    let app_menu = SubmenuBuilder::new(app, name)
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let mut view = SubmenuBuilder::with_id(app, "view", "View")
        .item(&MenuItemBuilder::with_id("zoom-in", "Zoom In").accelerator("CmdOrCtrl+=").build(app)?)
        .item(&MenuItemBuilder::with_id("zoom-out", "Zoom Out").accelerator("CmdOrCtrl+-").build(app)?)
        .item(&MenuItemBuilder::with_id("zoom-reset", "Actual Size").accelerator("CmdOrCtrl+0").build(app)?)
        .separator();
    for (id, label, _) in PLACES {
        view = view.item(&CheckMenuItemBuilder::with_id(id, label).build(app)?);
    }
    let view = view.separator().item(&PredefinedMenuItem::fullscreen(app, None)?).build()?;
    let mut go = SubmenuBuilder::new(app, "Go")
        .item(&MenuItemBuilder::with_id("go-back", "Back").accelerator("CmdOrCtrl+[").build(app)?)
        .item(&MenuItemBuilder::with_id("go-forward", "Forward").accelerator("CmdOrCtrl+]").build(app)?)
        .separator();
    for (id, label, _, keys) in SCREENS {
        go = go.item(&MenuItemBuilder::with_id(id, label).accelerator(keys).build(app)?);
    }
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;
    MenuBuilder::new(app).items(&[&app_menu, &edit, &view, &go.build()?, &window]).build()
}

/// What a menu entry of this module does, in the main window's page.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    if let Some((_, _, place)) = PLACES.iter().find(|p| p.0 == event.id().as_ref()) {
        check_place(app, place);
        let _ = app.emit("timeline-position", *place);
        return;
    }
    let Some(window) = app.get_webview_window("main") else { return };
    let webview: &Webview<R> = window.as_ref();
    let id = event.id().as_ref();
    let script = match id {
        "zoom-in" => return zoom(webview, 1),
        "zoom-out" => return zoom(webview, -1),
        "zoom-reset" => return zoom(webview, 0),
        "go-back" => "history.back()".to_string(),
        "go-forward" => "history.forward()".to_string(),
        _ => match SCREENS.iter().find(|s| s.0 == id) {
            Some((_, _, hash, _)) => format!("location.hash = '{hash}'"),
            None => return,
        },
    };
    let _ = webview.eval(&script);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_steps_stay_within_bounds_and_reset_to_actual_size() {
        assert_eq!(STEPS[5], 1.0);
        assert_eq!(step(5, 1), 6);
        assert_eq!(step(5, -1), 4);
        assert_eq!(step(STEPS.len() - 1, 1), STEPS.len() - 1);
        assert_eq!(step(0, -1), 0);
        assert_eq!(step(9, 0), 5);
    }

    #[test]
    fn every_screen_has_a_distinct_entry_and_shortcut() {
        let ids: std::collections::HashSet<_> = SCREENS.iter().map(|s| s.0).collect();
        let keys: std::collections::HashSet<_> = SCREENS.iter().map(|s| s.3).collect();
        assert_eq!(ids.len(), SCREENS.len());
        assert_eq!(keys.len(), SCREENS.len());
        assert!(SCREENS.iter().all(|s| s.2.starts_with('#') && !s.2.contains('\'')));
    }

    #[test]
    fn the_timeline_entries_name_the_two_places_and_no_screen() {
        assert_eq!(PLACES.map(|p| p.2), ["top", "bottom"]);
        assert!(PLACES.iter().all(|p| SCREENS.iter().all(|s| s.0 != p.0)));
    }
}
