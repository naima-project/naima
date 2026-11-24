// What tells one project's window from another's: the window's title is the project's name, and its Dock (macOS) or taskbar
// (Windows, Linux) icon is the Naima icon (the site's NAI tile) with a badge in the corner, a colour taken from the name and the name's initial.
// Every project has its own app process, so the icon is set per process, at runtime; the icon in the bundle stays the plain one.

use serde_json::Value;
use std::path::Path;

/// The name the window shows for the project at `root`: the name the recent projects list gives it, else its folder's name.
pub fn project_name(root: &Path, recent: Option<&Value>) -> String {
    let named = recent
        .and_then(|r| r.get("projects"))
        .and_then(Value::as_array)
        .and_then(|ps| ps.iter().find(|p| p.get("root").and_then(Value::as_str).map(Path::new) == Some(root)))
        .and_then(|p| p.get("name").and_then(Value::as_str))
        .filter(|n| !n.trim().is_empty());
    named.map(str::to_string).unwrap_or_else(|| root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "Naima".into()))
}

/// The initial the badge shows: the name's first letter or digit, in capitals, when it is an ASCII one.
pub fn initial(name: &str) -> Option<char> {
    name.chars().find(|c| c.is_alphanumeric()).map(|c| c.to_ascii_uppercase()).filter(char::is_ascii_alphanumeric)
}

/// Colours that stay apart from each other and from the icon's own light blue, dark and white.
const COLOURS: [[u8; 3]; 8] = [
    [0xd9, 0x4f, 0x3d],
    [0xe0, 0x8a, 0x1e],
    [0x2f, 0x9e, 0x5b],
    [0x1f, 0x9f, 0xa8],
    [0x7a, 0x4f, 0xc9],
    [0xc2, 0x3f, 0x8e],
    [0x8a, 0x6a, 0x3c],
    [0x4a, 0x5a, 0x6a],
];

/// The badge's colour: the same for the same name, on every machine (FNV-1a over its bytes).
pub fn colour(name: &str) -> [u8; 3] {
    let mut h: u32 = 0x811c_9dc5;
    for b in name.to_lowercase().bytes() {
        h = (h ^ b as u32).wrapping_mul(0x0100_0193);
    }
    COLOURS[(h as usize) % COLOURS.len()]
}

/// A glyph of 5 by 7 cells, one string a row, for each letter and digit.
fn glyph(c: char) -> [&'static str; 7] {
    match c {
        'A' => ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
        'B' => ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
        'C' => ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
        'D' => ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
        'E' => ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
        'F' => ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
        'G' => ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
        'H' => ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
        'I' => ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
        'J' => ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
        'K' => ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
        'L' => ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
        'M' => ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
        'N' => ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
        'O' => ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
        'P' => ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
        'Q' => ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
        'R' => ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
        'S' => ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
        'T' => ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
        'U' => ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
        'V' => ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
        'W' => ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
        'X' => ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
        'Y' => ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
        'Z' => ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
        '0' => ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
        '1' => ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
        '2' => ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
        '3' => ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
        '4' => ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
        '5' => ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
        '6' => ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
        '7' => ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
        '8' => ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
        '9' => ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
        _ => ["00000"; 7],
    }
}

/// How much of the glyph covers the point (x, y), in cells: the cells blended, then cut sharply, so the letter's corners are round.
fn cover(g: &[&str; 7], x: f32, y: f32) -> f32 {
    let cell = |cx: i32, cy: i32| -> f32 {
        if !(0..5).contains(&cx) || !(0..7).contains(&cy) {
            return 0.0;
        }
        (g[cy as usize].as_bytes()[cx as usize] == b'1') as u8 as f32
    };
    let (fx, fy) = (x - 0.5, y - 0.5);
    let (x0, y0) = (fx.floor(), fy.floor());
    let (tx, ty) = (fx - x0, fy - y0);
    let (x0, y0) = (x0 as i32, y0 as i32);
    let top = cell(x0, y0) * (1.0 - tx) + cell(x0 + 1, y0) * tx;
    let bottom = cell(x0, y0 + 1) * (1.0 - tx) + cell(x0 + 1, y0 + 1) * tx;
    let v = top * (1.0 - ty) + bottom * ty;
    ((v - 0.35) / 0.3).clamp(0.0, 1.0)
}

fn over(px: &mut [u8], rgb: [u8; 3], a: f32) {
    for i in 0..3 {
        px[i] = (rgb[i] as f32 * a + px[i] as f32 * (1.0 - a)).round() as u8;
    }
    px[3] = (255.0 * a + px[3] as f32 * (1.0 - a)).round() as u8;
}

/// `rgba` (a square icon, `size` pixels a side) with the project's badge in its bottom right corner: a white ring, the colour,
/// and the initial in white.
pub fn badged(rgba: &[u8], size: u32, name: &str) -> Vec<u8> {
    let mut out = rgba.to_vec();
    let s = size as f32;
    let (cx, cy, r) = (s * 0.755, s * 0.755, s * 0.19);
    let rgb = colour(name);
    let g = initial(name).map(glyph);
    // The glyph is 5 by 7 cells: its height is 1.25 times the ring's radius.
    let cell = r * 1.25 / 7.0;
    for py in 0..size {
        for px in 0..size {
            let (x, y) = (px as f32 + 0.5, py as f32 + 0.5);
            let d = ((x - cx).powi(2) + (y - cy).powi(2)).sqrt();
            let at = ((py * size + px) * 4) as usize;
            let pixel = &mut out[at..at + 4];
            let ring = (r + 0.5 - d).clamp(0.0, 1.0);
            if ring > 0.0 {
                over(pixel, [255, 255, 255], ring);
            }
            let fill = (r * 0.86 + 0.5 - d).clamp(0.0, 1.0);
            if fill > 0.0 {
                over(pixel, rgb, fill);
            }
            if let (Some(g), true) = (&g, d < r * 0.86) {
                let a = cover(g, (x - cx) / cell + 2.5, (y - cy) / cell + 3.5);
                if a > 0.0 {
                    over(pixel, [255, 255, 255], a);
                }
            }
        }
    }
    out
}

/// The icon, as RGBA and its side in pixels, read from a square PNG.
pub fn decode(png_bytes: &[u8]) -> Result<(Vec<u8>, u32), String> {
    let mut reader = png::Decoder::new(std::io::Cursor::new(png_bytes)).read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0; reader.output_buffer_size().ok_or("the icon is too large")?];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight || info.width != info.height {
        return Err("the icon is not a square 8-bit RGBA PNG".into());
    }
    buf.truncate(info.buffer_size());
    Ok((buf, info.width))
}

/// A square RGBA image as PNG (the Dock icon is handed over encoded).
#[cfg(any(target_os = "macos", test))]
pub fn encode(rgba: &[u8], size: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, size, size);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header().and_then(|mut w| w.write_image_data(rgba)).map_err(|e| e.to_string())?;
    Ok(out)
}

/// Names the window after the project at the sidecar's root and gives it the project's icon: the title, and the Dock or taskbar icon.
/// Never fails: a window without its badge is still the project's.
pub fn show(app: &tauri::AppHandle, sidecar: &crate::bridge::Sidecar) {
    use tauri::Manager;
    let recent = sidecar.call("recent", serde_json::json!({})).ok();
    let name = project_name(sidecar.root(), recent.as_ref());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title(&name);
        #[cfg(not(target_os = "macos"))]
        if let Ok((rgba, size)) = decode(include_bytes!("../icons/icon.png")) {
            let _ = window.set_icon(tauri::image::Image::new_owned(badged(&rgba, size, &name), size, size));
        }
    }
    #[cfg(target_os = "macos")]
    if let Ok((rgba, size)) = decode(include_bytes!("../icons/dock.png")) {
        if let Ok(png_bytes) = encode(&badged(&rgba, size, &name), size) {
            let _ = app.run_on_main_thread(move || set_dock_icon(&png_bytes));
        }
    }
}

/// The Dock icon on macOS: a window of its own to each project, so the process's application icon.
#[cfg(target_os = "macos")]
pub fn set_dock_icon(png_bytes: &[u8]) {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    // SAFETY: called on the main thread, with an NSData of the PNG's bytes the image copies.
    unsafe {
        let data: *mut AnyObject = msg_send![class!(NSData), dataWithBytes: png_bytes.as_ptr(), length: png_bytes.len()];
        let image: *mut AnyObject = msg_send![class!(NSImage), alloc];
        let image: *mut AnyObject = msg_send![image, initWithData: data];
        if image.is_null() {
            return;
        }
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let _: () = msg_send![app, setApplicationIconImage: image];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn names_the_project_from_the_list_or_its_folder() {
        let recent = json!({ "projects": [{ "name": "Alpha", "root": "/p/alpha-dir" }] });
        assert_eq!(project_name(Path::new("/p/alpha-dir"), Some(&recent)), "Alpha");
        assert_eq!(project_name(Path::new("/p/beta"), Some(&recent)), "beta");
        assert_eq!(project_name(Path::new("/p/beta"), None), "beta");
        assert_eq!(project_name(Path::new("/"), None), "Naima");
    }

    #[test]
    fn the_badge_is_the_names_initial_and_a_colour_that_is_the_same_each_time() {
        assert_eq!(initial("alpha"), Some('A'));
        assert_eq!(initial("  7up"), Some('7'));
        assert_eq!(initial("-- x"), Some('X'));
        assert_eq!(initial("é"), None);
        assert_eq!(initial(""), None);
        assert_eq!(colour("Alpha"), colour("alpha"));
        assert!((0..60).map(|i| colour(&format!("project-{i}"))).collect::<std::collections::HashSet<_>>().len() >= 6);
    }

    #[test]
    fn two_projects_get_two_icons_that_differ_and_leave_the_rest_of_the_icon_alone() {
        let size = 128u32;
        let base = vec![200u8; (size * size * 4) as usize];
        let a = badged(&base, size, "alpha");
        let b = badged(&base, size, "bravo");
        assert_ne!(a, b);
        assert_eq!(badged(&base, size, "alpha"), a);
        // The top left corner is untouched; the badge's centre is not the icon's own colour.
        assert_eq!(&a[..4], &base[..4]);
        let centre = (((size as f32 * 0.755) as u32 * size + (size as f32 * 0.755) as u32) * 4) as usize;
        assert_ne!(&a[centre..centre + 4], &base[centre..centre + 4]);
    }

    #[test]
    fn the_shipped_icons_decode_and_badge() {
        for bytes in [&include_bytes!("../icons/dock.png")[..], &include_bytes!("../icons/icon.png")[..]] {
            let (rgba, size) = decode(bytes).unwrap();
            assert_eq!(rgba.len() as u32, size * size * 4);
            let (again, again_size) = decode(&encode(&badged(&rgba, size, "Naima"), size).unwrap()).unwrap();
            assert_eq!((again.len(), again_size), (rgba.len(), size));
        }
    }
}
