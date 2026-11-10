// The naima-files: scheme: a file of a tab's folder, a page or a frame the page shows, read through the sidecar's
// `file` command and served sandboxed, as `naima ui` serves it at /files/ in a browser: an opaque origin of its own,
// scripts and forms allowed, nothing loaded from elsewhere, no connection anywhere. On Windows the webview names it
// http://naima-files.localhost/<tab>/<path>, elsewhere naima-files://localhost/<tab>/<path>.

use crate::bridge::Sidecar;
use base64::Engine;
use serde_json::json;
use std::sync::Arc;
use tauri::http::{header, Request, Response};
use tauri::UriSchemeResponder;

const POLICY: &str = "sandbox allow-scripts allow-forms; default-src 'self' naima-files: http://naima-files.localhost; \
script-src 'self' 'unsafe-inline' naima-files: http://naima-files.localhost; style-src 'self' 'unsafe-inline' naima-files: \
http://naima-files.localhost; img-src 'self' data: naima-files: http://naima-files.localhost; font-src 'self' data: naima-files: \
http://naima-files.localhost; connect-src 'none'; base-uri 'none'; object-src 'none'";

/// A path segment with its %XX escapes decoded.
fn decoded(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Answers one request of the scheme, off the main thread.
pub fn serve(sidecar: Arc<Sidecar>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    std::thread::spawn(move || {
        let path = request.uri().path().trim_start_matches('/').to_string();
        let (tab, rel) = path.split_once('/').unwrap_or((path.as_str(), ""));
        let rel: Vec<String> = rel.split('/').map(decoded).collect();
        let answer = sidecar.call("file", json!({ "tab": decoded(tab), "path": rel.join("/") }));
        let response = match answer {
            Ok(file) => {
                let body = file["base64"].as_str().and_then(|b| base64::engine::general_purpose::STANDARD.decode(b).ok());
                match body {
                    Some(bytes) => Response::builder()
                        .header(header::CONTENT_TYPE, file["type"].as_str().unwrap_or("application/octet-stream"))
                        .header(header::CONTENT_SECURITY_POLICY, POLICY)
                        .header(header::CACHE_CONTROL, "no-store")
                        .body(bytes),
                    None => Response::builder().status(500).body(b"naima: a file that is not one".to_vec()),
                }
            }
            Err(e) => Response::builder().status(404).body(format!("naima: {e}").into_bytes()),
        };
        responder.respond(response.unwrap_or_else(|_| Response::new(Vec::new())));
    });
}
