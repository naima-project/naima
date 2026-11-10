// The page the window shows: the UI bundle of the project's own program (its ui/dist, the one `naima ui` serves in a
// browser), read from disk at each request, so that a `naima update` is all a landing takes and the app is rebuilt only
// when this shell changes. The sidecar names the folder (`bundle`); the shell reads the files, as the webview asks for
// them, on the app's own scheme, so the page keeps its local rights and nothing is fetched from anywhere. The bundle the
// app was built with stays as the fallback, for a program that names no bundle or whose folder holds no page.

use std::borrow::Cow;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{Assets, Wry};

/// The folder of the project's bundle, when it has one: set when a sidecar starts, and again when the person switches project.
#[derive(Clone, Default)]
pub struct Dir(Arc<Mutex<Option<PathBuf>>>);

impl Dir {
    /// Uses `dir` for the page from now on when it holds one; else the bundle the app was built with.
    pub fn set(&self, dir: Option<PathBuf>) {
        *self.0.lock().unwrap() = dir.filter(|d| d.join("index.html").is_file());
    }

    /// Whether the project's bundle is the page.
    pub fn in_use(&self) -> bool {
        self.get().is_some()
    }

    fn get(&self) -> Option<PathBuf> {
        self.0.lock().unwrap().clone()
    }
}

/// The file `key` names in `dir`: nothing for a path that leaves it.
fn read(dir: &Path, key: &str) -> Option<Vec<u8>> {
    let rel = Path::new(key.trim_start_matches('/'));
    if rel.as_os_str().is_empty() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return None;
    }
    std::fs::read(dir.join(rel)).ok()
}

/// The assets of the window: the project's bundle while it has one, else the embedded one.
pub struct Bundle {
    embedded: Box<dyn Assets<Wry>>,
    dir: Dir,
}

impl Bundle {
    pub fn new(embedded: Box<dyn Assets<Wry>>, dir: Dir) -> Bundle {
        Bundle { embedded, dir }
    }
}

impl Assets<Wry> for Bundle {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        match self.dir.get() {
            // Once the project's bundle is the page, a file it lacks is not taken from the other one: the two never mix.
            Some(dir) => read(&dir, key.as_ref()).map(Cow::Owned),
            None => self.embedded.get(key),
        }
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        self.embedded.iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        match self.dir.get() {
            Some(_) => Box::new(std::iter::empty()),
            None => self.embedded.csp_hashes(html_path),
        }
    }
}

/// What stands in the context while the embedded assets are moved into the bundle.
pub struct Nothing;

impl Assets<Wry> for Nothing {
    fn get(&self, _: &AssetKey) -> Option<Cow<'_, [u8]>> {
        None
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }

    fn csp_hashes(&self, _: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_inside_the_folder_and_only_with_a_page() {
        let dir = std::env::temp_dir().join(format!("naima-bundle-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::write(dir.join("index.html"), "page").unwrap();
        std::fs::write(dir.join("assets").join("a.js"), "js").unwrap();
        assert_eq!(read(&dir, "/index.html"), Some(b"page".to_vec()));
        assert_eq!(read(&dir, "/assets/a.js"), Some(b"js".to_vec()));
        assert_eq!(read(&dir, "/../secret"), None);
        assert_eq!(read(&dir, "/assets/../index.html"), None);
        assert_eq!(read(&dir, "/missing.js"), None);
        let shown = Dir::default();
        shown.set(Some(dir.clone()));
        assert_eq!(shown.get(), Some(dir.clone()));
        shown.set(Some(dir.join("assets")));
        assert_eq!(shown.get(), None, "a folder without a page is not the bundle");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
